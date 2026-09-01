import { z } from "zod";

const rewardSchema = z.object({
  name: z.string().trim().min(1).max(80),
  displayUnit: z.string().trim().min(1).max(40),
  kind: z.enum(["ITEM", "CURRENCY", "POINTS", "CUSTOM"]),
  decimals: z.number().int().min(0).max(8),
  amount: z.number().finite().min(0).max(1_000_000_000_000_000),
}).strict();

const tierSchema = z.object({
  label: z.string().trim().min(1).max(50),
  description: z.string().trim().max(300).nullable(),
  minimumHits: z.number().int().min(0).max(1_000_000),
  maximumHits: z.number().int().min(0).max(1_000_000).nullable(),
  position: z.number().int().min(0).max(19),
  enabled: z.boolean(),
  rewards: z.array(rewardSchema).min(1).max(10),
}).strict().superRefine((tier, context) => {
  if (tier.maximumHits !== null && tier.maximumHits < tier.minimumHits) {
    context.addIssue({ code: "custom", path: ["maximumHits"], message: "A tier maximum cannot be lower than its minimum." });
  }
  if (new Set(tier.rewards.map((reward) => reward.name.toLocaleLowerCase("en-GB"))).size !== tier.rewards.length) {
    context.addIssue({ code: "custom", path: ["rewards"], message: "A tier cannot repeat the same reward definition." });
  }
});

const schemeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).nullable(),
  version: z.number().int().positive().max(1_000_000),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  isDefault: z.boolean(),
  tiers: z.array(tierSchema).min(1).max(20),
}).strict().superRefine((scheme, context) => {
  if (new Set(scheme.tiers.map((tier) => tier.position)).size !== scheme.tiers.length) {
    context.addIssue({ code: "custom", path: ["tiers"], message: "Tier positions must be unique within a scheme." });
  }

  const definitions = new Map<string, string>();
  for (const [tierIndex, tier] of scheme.tiers.entries()) {
    for (const [rewardIndex, reward] of tier.rewards.entries()) {
      const key = reward.name.toLocaleLowerCase("en-GB");
      const signature = JSON.stringify([reward.displayUnit, reward.kind, reward.decimals]);
      const existing = definitions.get(key);
      if (existing && existing !== signature) {
        context.addIssue({
          code: "custom",
          path: ["tiers", tierIndex, "rewards", rewardIndex],
          message: "A named reward must use one consistent unit, kind, and precision throughout a scheme.",
        });
      } else {
        definitions.set(key, signature);
      }
    }
  }
});

export const workspaceBackupSchema = z.object({
  format: z.literal("chainward-workspace-backup"),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  faction: z.object({
    tornFactionId: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
    tag: z.string().trim().max(20),
  }).strict(),
  settings: z.array(z.object({
    key: z.string().min(1).max(120).regex(/^(appearance|rewards|payouts|members)\./),
    value: z.unknown(),
  }).strict()).max(500),
  rewardSchemes: z.array(schemeSchema).max(200),
}).strict().superRefine((backup, context) => {
  const schemeVersions = backup.rewardSchemes.map((scheme) => `${scheme.name.toLocaleLowerCase("en-GB")}\u0000${scheme.version}`);
  if (new Set(schemeVersions).size !== schemeVersions.length) {
    context.addIssue({ code: "custom", path: ["rewardSchemes"], message: "Scheme names and versions must be unique within a backup." });
  }
  if (backup.rewardSchemes.filter((scheme) => scheme.isDefault).length > 1) {
    context.addIssue({ code: "custom", path: ["rewardSchemes"], message: "A backup can contain only one default reward scheme." });
  }

  const definitions = new Map<string, string>();
  for (const [schemeIndex, scheme] of backup.rewardSchemes.entries()) {
    for (const [tierIndex, tier] of scheme.tiers.entries()) {
      for (const [rewardIndex, reward] of tier.rewards.entries()) {
        const key = reward.name.toLocaleLowerCase("en-GB");
        const signature = JSON.stringify([reward.displayUnit, reward.kind, reward.decimals]);
        const existing = definitions.get(key);
        if (existing && existing !== signature) {
          context.addIssue({
            code: "custom",
            path: ["rewardSchemes", schemeIndex, "tiers", tierIndex, "rewards", rewardIndex],
            message: "A named reward must keep one unit, kind, and precision throughout the backup.",
          });
        } else {
          definitions.set(key, signature);
        }
      }
    }
  }
});

export type WorkspaceBackup = z.infer<typeof workspaceBackupSchema>;

/**
 * SQLite deliberately stores one whole-number item reward per tier. Reject a
 * richer PostgreSQL backup instead of silently dropping reward definitions or
 * changing their meaning during a cross-backend restore.
 */
export function localBackupCompatibilityIssue(backup: WorkspaceBackup): string | null {
  for (const scheme of backup.rewardSchemes) {
    const rewards = scheme.tiers.flatMap((tier) => tier.rewards);
    const first = rewards[0];
    if (!first) continue;
    const compatible = scheme.tiers.every((tier) => tier.rewards.length === 1)
      && first.kind === "ITEM"
      && first.decimals === 0
      && rewards.every((reward) => reward.name === first.name
        && reward.displayUnit === first.displayUnit
        && reward.kind === first.kind
        && reward.decimals === first.decimals);
    if (!compatible) {
      return `“${scheme.name}” uses reward data that local-file storage cannot preserve. Restore this backup into PostgreSQL instead.`;
    }
  }
  return null;
}
