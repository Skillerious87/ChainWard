"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { localDatabaseExists, openLocalDatabase } from "@/lib/data/local-database";
import { validateRewardTiers } from "@/lib/rewards/reward-engine";

const tierSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().trim().min(1).max(50),
  minimumHits: z.number().int().min(0).max(1_000_000),
  maximumHits: z.number().int().min(0).max(1_000_000).nullable(),
  amount: z.number().finite().min(0).max(1_000_000),
  enabled: z.boolean(),
});

const saveSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300),
  rewardName: z.string().trim().min(1).max(40),
  rewardUnit: z.string().trim().min(1).max(24),
  isDefault: z.boolean(),
  tiers: z.array(tierSchema).min(1).max(20),
});

const idSchema = z.string().uuid();

export interface SaveRewardSchemeResult {
  id: string;
  mode: "created" | "updated" | "versioned";
  version: number;
}

export async function saveRewardScheme(input: unknown): Promise<SaveRewardSchemeResult> {
  requireStorage();
  const parsed = saveSchema.parse(input);
  const issues = validateRewardTiers(parsed.tiers.map((tier, position) => ({
    id: tier.id,
    label: tier.label,
    minimumHits: tier.minimumHits,
    maximumHits: tier.maximumHits,
    position,
    enabled: tier.enabled,
    rewards: [{ reward: { id: "draft-reward", name: parsed.rewardName, displayUnit: parsed.rewardUnit, kind: "item", decimals: 0 }, amount: tier.amount }],
  })));
  if (issues.length) throw new Error(issues[0]?.message ?? "The tier ranges are invalid.");

  const { faction } = await requireFactionPermission("rewards:manage");
  if (!process.env.DATABASE_URL) {
    const result = saveLocalRewardScheme(parsed, faction.id);
    revalidatePath("/rewards");
    return result;
  }
  const { db } = await import("@/lib/db");
  const storedFaction = await db.faction.upsert({
    where: { tornFactionId: faction.id },
    update: { name: faction.name, tag: faction.tag },
    create: { tornFactionId: faction.id, name: faction.name, tag: faction.tag },
  });

  const result = await db.$transaction(async (tx) => {
    const source = parsed.id ? await tx.rewardScheme.findFirst({
      where: { id: parsed.id, factionId: storedFaction.id },
      include: { _count: { select: { assignedChains: true, rewardSnapshots: true } }, tiers: { select: { id: true } } },
    }) : null;
    if (parsed.id && !source) throw new Error("The selected reward scheme no longer exists.");

    const rewardDefinition = await tx.rewardDefinition.upsert({
      where: { factionId_name: { factionId: storedFaction.id, name: parsed.rewardName } },
      update: { displayUnit: parsed.rewardUnit, isArchived: false },
      create: { factionId: storedFaction.id, name: parsed.rewardName, displayUnit: parsed.rewardUnit, kind: "ITEM" },
    });
    if (parsed.isDefault) await tx.rewardScheme.updateMany({ where: { factionId: storedFaction.id, isDefault: true }, data: { isDefault: false } });

    const locked = Boolean(source && (source._count.assignedChains > 0 || source._count.rewardSnapshots > 0));
    if (source && !locked) {
      if (source.tiers.length) {
        await tx.rewardTierReward.deleteMany({ where: { tierId: { in: source.tiers.map((tier) => tier.id) } } });
        await tx.rewardTier.deleteMany({ where: { schemeId: source.id } });
      }
      const updated = await tx.rewardScheme.update({
        where: { id: source.id },
        data: { name: parsed.name, description: parsed.description || null, isDefault: parsed.isDefault, status: "ACTIVE", tiers: { create: tierCreates(parsed.tiers, rewardDefinition.id) } },
      });
      return { id: updated.id, version: updated.version, mode: "updated" as const };
    }

    let version = 1;
    if (source) {
      const latest = await tx.rewardScheme.aggregate({ where: { factionId: storedFaction.id, name: parsed.name }, _max: { version: true } });
      version = (latest._max.version ?? source.version) + 1;
      await tx.rewardScheme.update({ where: { id: source.id }, data: { status: "ARCHIVED", isDefault: false } });
    }
    const created = await tx.rewardScheme.create({
      data: { factionId: storedFaction.id, name: parsed.name, description: parsed.description || null, version, isDefault: parsed.isDefault, tiers: { create: tierCreates(parsed.tiers, rewardDefinition.id) } },
    });
    return { id: created.id, version: created.version, mode: source ? "versioned" as const : "created" as const };
  });

  revalidatePath("/rewards");
  return result;
}

export async function setRewardSchemeArchived(input: unknown): Promise<{ id: string; archived: boolean }> {
  requireStorage();
  const parsed = z.object({ id: idSchema, archived: z.boolean() }).parse(input);
  const { faction } = await requireFactionPermission("rewards:manage");
  if (!process.env.DATABASE_URL) {
    const database = openLocalDatabase();
    if (!database) throw new Error("Create the local database before changing rewards.");
    try {
      const existing = database.prepare("SELECT id FROM reward_schemes WHERE id = ? AND faction_id = ?").get(parsed.id, faction.id);
      if (!existing) throw new Error("Reward scheme not found for this faction.");
      database.prepare("UPDATE reward_schemes SET status = ?, is_default = CASE WHEN ? = 1 THEN 0 ELSE is_default END, updated_at = ? WHERE id = ?").run(parsed.archived ? "ARCHIVED" : "ACTIVE", parsed.archived ? 1 : 0, new Date().toISOString(), parsed.id);
    } finally { database.close(); }
    revalidatePath("/rewards");
    return { id: parsed.id, archived: parsed.archived };
  }
  const { db } = await import("@/lib/db");
  const stored = await db.rewardScheme.findFirst({ where: { id: parsed.id, faction: { tornFactionId: faction.id } } });
  if (!stored) throw new Error("Reward scheme not found for this faction.");
  await db.rewardScheme.update({ where: { id: stored.id }, data: { status: parsed.archived ? "ARCHIVED" : "ACTIVE", isDefault: parsed.archived ? false : stored.isDefault } });
  revalidatePath("/rewards");
  return { id: stored.id, archived: parsed.archived };
}

function tierCreates(tiers: z.infer<typeof tierSchema>[], rewardDefinitionId: string) {
  return tiers.map((tier, position) => ({
    minimumHits: tier.minimumHits,
    maximumHits: tier.maximumHits,
    label: tier.label,
    position,
    isEnabled: tier.enabled,
    rewards: { create: [{ rewardDefinitionId, amount: tier.amount }] },
  }));
}

function requireStorage(): void {
  if (!process.env.DATABASE_URL && !localDatabaseExists()) throw new Error("Create the local database file in Settings before saving reward schemes.");
}

function saveLocalRewardScheme(parsed: z.infer<typeof saveSchema>, factionId: number): SaveRewardSchemeResult {
  const database = openLocalDatabase();
  if (!database) throw new Error("Create the local database file in Settings before saving reward schemes.");
  const now = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    const source = parsed.id ? database.prepare("SELECT id, version, locked_by_history FROM reward_schemes WHERE id = ? AND faction_id = ?").get(parsed.id, factionId) as { id: string; version: number; locked_by_history: number } | undefined : undefined;
    if (parsed.id && !source) throw new Error("The selected reward scheme no longer exists.");
    if (parsed.isDefault) database.prepare("UPDATE reward_schemes SET is_default = 0, updated_at = ? WHERE faction_id = ? AND is_default = 1").run(now, factionId);

    let id = source?.id ?? crypto.randomUUID();
    let version = source?.version ?? 1;
    let mode: SaveRewardSchemeResult["mode"] = source ? "updated" : "created";
    if (source?.locked_by_history) {
      const latest = database.prepare("SELECT MAX(version) AS version FROM reward_schemes WHERE faction_id = ? AND name = ?").get(factionId, parsed.name) as { version: number | null };
      version = (latest.version ?? source.version) + 1;
      id = crypto.randomUUID();
      mode = "versioned";
      database.prepare("UPDATE reward_schemes SET status = 'ARCHIVED', is_default = 0, updated_at = ? WHERE id = ?").run(now, source.id);
    }

    if (mode === "updated") {
      database.prepare("UPDATE reward_schemes SET name = ?, description = ?, is_default = ?, reward_name = ?, reward_unit = ?, status = 'ACTIVE', updated_at = ? WHERE id = ?").run(parsed.name, parsed.description, parsed.isDefault ? 1 : 0, parsed.rewardName, parsed.rewardUnit, now, id);
      database.prepare("DELETE FROM reward_tiers WHERE scheme_id = ?").run(id);
    } else {
      database.prepare("INSERT INTO reward_schemes (id, faction_id, name, description, version, status, is_default, reward_name, reward_unit, locked_by_history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 0, ?, ?)").run(id, factionId, parsed.name, parsed.description, version, parsed.isDefault ? 1 : 0, parsed.rewardName, parsed.rewardUnit, now, now);
    }
    const insertTier = database.prepare("INSERT INTO reward_tiers (id, scheme_id, label, minimum_hits, maximum_hits, amount, enabled, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    parsed.tiers.forEach((tier, position) => insertTier.run(crypto.randomUUID(), id, tier.label, tier.minimumHits, tier.maximumHits, tier.amount, tier.enabled ? 1 : 0, position));
    database.exec("COMMIT");
    return { id, mode, version };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally { database.close(); }
}
