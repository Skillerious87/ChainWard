import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { cache } from "react";
import { localDatabaseExists, openLocalDatabase } from "@/lib/data/local-database";
import {
  battleStatsSharePreferenceSchema,
  memberBattleStatsSchema,
  type BattleStatsSharePreference,
  type MemberBattleStats,
} from "./member-battle-stats";

interface Faction { id: number; name: string; tag: string }

// Shared battle stats and the auto-share preference both carry a member's
// personal choice, so — like the retired `oc.private.` keys — they use a prefix
// OUTSIDE the `appearance|rewards|payouts|members` set that the workspace backup
// exports. Importing a backup must never restore withdrawn consent.
const statsPrefix = "member-intel.private.";
const prefPrefix = "member-intel.pref.";

export interface MemberBattleStatsWorkspace {
  databaseConfigured: boolean;
  databaseAvailable: boolean;
  records: MemberBattleStats[];
  message: string;
}

export const getMemberBattleStatsWorkspace = cache(async (factionId: number | null): Promise<MemberBattleStatsWorkspace> => {
  const hasPostgres = Boolean(process.env.DATABASE_URL?.trim());
  if (!hasPostgres && !localDatabaseExists()) {
    return { databaseConfigured: false, databaseAvailable: false, records: [], message: "Create local storage in Settings to share and review battle stats." };
  }
  if (!factionId) {
    return { databaseConfigured: true, databaseAvailable: true, records: [], message: "Connect a verified faction to review shared battle stats." };
  }
  try {
    const records = await readMemberBattleStats(factionId);
    return {
      databaseConfigured: true,
      databaseAvailable: true,
      records,
      message: records.length ? `${records.length} member${records.length === 1 ? "" : "s"} sharing battle stats.` : "No member has shared their battle stats yet.",
    };
  } catch (error) {
    return { databaseConfigured: true, databaseAvailable: false, records: [], message: error instanceof Error ? error.message : "Shared battle stats could not be read." };
  }
});

export async function readMemberBattleStats(factionId: number, ownUserId?: number): Promise<MemberBattleStats[]> {
  const key = ownUserId === undefined ? undefined : `${statsPrefix}${ownUserId}`;
  let values: unknown[];
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    const rows = await db.factionSetting.findMany({
      where: { faction: { tornFactionId: factionId }, key: key ?? { startsWith: statsPrefix } },
      select: { value: true },
    });
    values = rows.map((row) => row.value);
  } else {
    const database = openLocalDatabase();
    if (!database) throw new Error("Create storage in Settings before sharing battle stats.");
    try {
      const rows = (key
        ? database.prepare("SELECT value_json FROM faction_settings WHERE faction_id = ? AND key = ?").all(factionId, key)
        : database.prepare("SELECT value_json FROM faction_settings WHERE faction_id = ? AND key LIKE ?").all(factionId, `${statsPrefix}%`)) as Array<{ value_json: string }>;
      values = rows.map((row) => JSON.parse(row.value_json) as unknown);
    } finally { database.close(); }
  }
  return values
    .map((value) => memberBattleStatsSchema.parse(value))
    .filter((record) => record.factionId === factionId && (ownUserId === undefined || record.tornUserId === ownUserId));
}

export async function saveMemberBattleStats(faction: Faction, value: MemberBattleStats): Promise<void> {
  const record = memberBattleStatsSchema.parse(value);
  if (record.factionId !== faction.id) throw new Error("The shared battle stats belong to a different faction.");
  const key = `${statsPrefix}${record.tornUserId}`;
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await db.$transaction(async (tx) => {
      const tenant = await tx.faction.upsert({ where: { tornFactionId: faction.id }, update: {}, create: { tornFactionId: faction.id, name: faction.name, tag: faction.tag } });
      await tx.factionSetting.upsert({
        where: { factionId_key: { factionId: tenant.id, key } },
        create: { factionId: tenant.id, key, value: record as unknown as Prisma.InputJsonValue },
        update: { value: record as unknown as Prisma.InputJsonValue },
      });
    });
  } else {
    const database = openLocalDatabase();
    if (!database) throw new Error("Create storage in Settings before sharing battle stats.");
    try {
      database.prepare("INSERT INTO faction_settings (faction_id, key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(faction_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
        .run(faction.id, key, JSON.stringify(record), new Date().toISOString());
    } finally { database.close(); }
  }
}

export async function deleteMemberBattleStats(factionId: number, tornUserId: number): Promise<void> {
  const key = `${statsPrefix}${tornUserId}`;
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await db.factionSetting.deleteMany({ where: { faction: { tornFactionId: factionId }, key } });
  } else {
    const database = openLocalDatabase();
    if (!database) throw new Error("The battle-stats store is unavailable.");
    try { database.prepare("DELETE FROM faction_settings WHERE faction_id = ? AND key = ?").run(factionId, key); }
    finally { database.close(); }
  }
}

const defaultSharePref: BattleStatsSharePreference = { autoShare: false, lastAutoShareAt: null };

export async function readBattleStatsSharePreference(factionId: number, tornUserId: number): Promise<BattleStatsSharePreference> {
  const key = `${prefPrefix}${tornUserId}`;
  let raw: unknown;
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    const row = await db.factionSetting.findFirst({ where: { faction: { tornFactionId: factionId }, key }, select: { value: true } });
    raw = row?.value;
  } else {
    const database = openLocalDatabase();
    if (!database) return defaultSharePref;
    try {
      const row = database.prepare("SELECT value_json FROM faction_settings WHERE faction_id = ? AND key = ?").get(factionId, key) as { value_json: string } | undefined;
      raw = row ? (JSON.parse(row.value_json) as unknown) : undefined;
    } catch { return defaultSharePref; }
    finally { database.close(); }
  }
  const parsed = battleStatsSharePreferenceSchema.safeParse(raw);
  return parsed.success ? { autoShare: parsed.data.autoShare, lastAutoShareAt: parsed.data.lastAutoShareAt ?? null } : defaultSharePref;
}

export async function writeBattleStatsSharePreference(faction: Faction, tornUserId: number, value: BattleStatsSharePreference): Promise<void> {
  const record = battleStatsSharePreferenceSchema.parse(value);
  const key = `${prefPrefix}${tornUserId}`;
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await db.$transaction(async (tx) => {
      const tenant = await tx.faction.upsert({ where: { tornFactionId: faction.id }, update: {}, create: { tornFactionId: faction.id, name: faction.name, tag: faction.tag } });
      await tx.factionSetting.upsert({
        where: { factionId_key: { factionId: tenant.id, key } },
        create: { factionId: tenant.id, key, value: record as unknown as Prisma.InputJsonValue },
        update: { value: record as unknown as Prisma.InputJsonValue },
      });
    });
  } else {
    const database = openLocalDatabase();
    if (!database) throw new Error("Create storage in Settings before changing sharing preferences.");
    try {
      database.prepare("INSERT INTO faction_settings (faction_id, key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(faction_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
        .run(faction.id, key, JSON.stringify(record), new Date().toISOString());
    } finally { database.close(); }
  }
}
