import "server-only";

import { localDatabaseExists, openLocalDatabase } from "@/lib/data/local-database";

export interface RewardTierView {
  id: string;
  label: string;
  minimumHits: number;
  maximumHits: number | null;
  amount: number;
  enabled: boolean;
}

export interface RewardSchemeView {
  id: string;
  name: string;
  description: string;
  version: number;
  status: "ACTIVE" | "ARCHIVED";
  isDefault: boolean;
  rewardName: string;
  rewardUnit: string;
  tiers: RewardTierView[];
  updatedAt: string;
  lockedByHistory: boolean;
}

export interface RewardWorkspaceView {
  databaseConfigured: boolean;
  databaseAvailable: boolean;
  schemes: RewardSchemeView[];
  message: string;
  revision: string;
}

export async function getRewardWorkspace(tornFactionId: number | null): Promise<RewardWorkspaceView> {
  if (!process.env.DATABASE_URL?.trim() && !localDatabaseExists()) return empty(false, false, "Create the local database file to save reward schemes on this device.");
  if (!tornFactionId) return empty(true, true, "Connect a Torn faction before creating reward schemes.");

  if (!process.env.DATABASE_URL?.trim()) return getLocalRewardWorkspace(tornFactionId);

  try {
    const { db } = await import("@/lib/db");
    const faction = await db.faction.findUnique({ where: { tornFactionId } });
    if (!faction) return empty(true, true, "No saved reward schemes exist for this faction yet.");
    const rows = await db.rewardScheme.findMany({
      where: { factionId: faction.id },
      orderBy: [{ status: "asc" }, { isDefault: "desc" }, { updatedAt: "desc" }],
      include: {
        tiers: {
          orderBy: { position: "asc" },
          include: { rewards: { include: { rewardDefinition: true } } },
        },
        _count: { select: { assignedChains: true, rewardSnapshots: true } },
      },
    });

    const schemes = rows.map<RewardSchemeView>((row) => {
      const firstReward = row.tiers.flatMap((tier) => tier.rewards)[0]?.rewardDefinition;
      return {
        id: row.id,
        name: row.name,
        description: row.description ?? "",
        version: row.version,
        status: row.status,
        isDefault: row.isDefault,
        rewardName: firstReward?.name ?? "Xanax",
        rewardUnit: firstReward?.displayUnit ?? "Xanax",
        updatedAt: row.updatedAt.toISOString(),
        lockedByHistory: row._count.assignedChains > 0 || row._count.rewardSnapshots > 0,
        tiers: row.tiers.map((tier) => ({
          id: tier.id,
          label: tier.label,
          minimumHits: tier.minimumHits,
          maximumHits: tier.maximumHits,
          amount: Number(tier.rewards[0]?.amount ?? 0),
          enabled: tier.isEnabled,
        })),
      };
    });
    const revision = schemes.map((scheme) => `${scheme.id}:${scheme.version}:${scheme.updatedAt}`).join("|") || "empty";
    return { databaseConfigured: true, databaseAvailable: true, schemes, message: schemes.length ? `${schemes.length} saved scheme version${schemes.length === 1 ? "" : "s"}.` : "No saved reward schemes exist for this faction yet.", revision };
  } catch {
    return empty(true, false, "The configured database could not be reached. No reward records were loaded.");
  }
}

function getLocalRewardWorkspace(tornFactionId: number): RewardWorkspaceView {
  const database = openLocalDatabase();
  if (!database) return empty(false, false, "Create the local database file to save reward schemes on this device.");
  try {
    const schemes = (database.prepare("SELECT * FROM reward_schemes WHERE faction_id = ? ORDER BY status ASC, is_default DESC, updated_at DESC").all(tornFactionId) as unknown as LocalSchemeRow[]).map<RewardSchemeView>((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      version: row.version,
      status: row.status,
      isDefault: Boolean(row.is_default),
      rewardName: row.reward_name,
      rewardUnit: row.reward_unit,
      updatedAt: row.updated_at,
      lockedByHistory: Boolean(row.locked_by_history),
      tiers: (database.prepare("SELECT * FROM reward_tiers WHERE scheme_id = ? ORDER BY position ASC").all(row.id) as unknown as LocalTierRow[]).map((tier) => ({ id: tier.id, label: tier.label, minimumHits: tier.minimum_hits, maximumHits: tier.maximum_hits, amount: tier.amount, enabled: Boolean(tier.enabled) })),
    }));
    const revision = schemes.map((scheme) => `${scheme.id}:${scheme.version}:${scheme.updatedAt}`).join("|") || "local-empty";
    return { databaseConfigured: true, databaseAvailable: true, schemes, message: schemes.length ? `${schemes.length} saved local scheme version${schemes.length === 1 ? "" : "s"}.` : "No reward schemes are saved in the local database yet.", revision };
  } catch {
    return empty(true, false, "The local database file could not be read safely.");
  } finally { database.close(); }
}

interface LocalSchemeRow {
  id: string;
  name: string;
  description: string;
  version: number;
  status: "ACTIVE" | "ARCHIVED";
  is_default: number;
  reward_name: string;
  reward_unit: string;
  updated_at: string;
  locked_by_history: number;
}

interface LocalTierRow {
  id: string;
  label: string;
  minimum_hits: number;
  maximum_hits: number | null;
  amount: number;
  enabled: number;
}

function empty(databaseConfigured: boolean, databaseAvailable: boolean, message: string): RewardWorkspaceView {
  return { databaseConfigured, databaseAvailable, schemes: [], message, revision: `${databaseConfigured}:${databaseAvailable}:empty` };
}
