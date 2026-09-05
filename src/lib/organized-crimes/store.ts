import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { openLocalDatabase } from "@/lib/data/local-database";
import { DEFAULT_MINIMUM_CPR, memberIntelSchema, ocReviewSettingsSchema, ocSharePreferenceSchema, type MemberIntel, type OcReviewSettings, type OcSharePreference } from "./types";

interface Faction { id: number; name: string; tag: string }
// Kept outside portable configuration backups: importing a backup must not restore withdrawn consent.
const prefix = "oc.private.";
// Per-member sharing preference (auto-share opt-in). Like the private records it
// carries personal choice, so it is also kept out of configuration backups.
const prefPrefix = "oc.pref.";
// Non-private review tuning, deliberately outside the `oc.private.` prefix so a
// configuration backup does carry it.
const settingsKey = "oc.review-settings";

export async function readMemberIntel(factionId: number, ownUserId?: number): Promise<MemberIntel[]> {
  const key = ownUserId === undefined ? undefined : `${prefix}${ownUserId}`;
  let values: unknown[];
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    const rows = await db.factionSetting.findMany({ where: { faction: { tornFactionId: factionId }, key: key ?? { startsWith: prefix } }, select: { value: true } });
    values = rows.map((row) => row.value);
  } else {
    const database = openLocalDatabase();
    if (!database) throw new Error("Create storage in Settings before sharing OC data.");
    try {
      const rows = (key
        ? database.prepare("SELECT value_json FROM faction_settings WHERE faction_id = ? AND key = ?").all(factionId, key)
        : database.prepare("SELECT value_json FROM faction_settings WHERE faction_id = ? AND key LIKE ?").all(factionId, `${prefix}%`)) as Array<{ value_json: string }>;
      values = rows.map((row) => JSON.parse(row.value_json) as unknown);
    } finally { database.close(); }
  }
  return values.map((value) => memberIntelSchema.parse(value)).filter((record) => record.factionId === factionId && (ownUserId === undefined || record.tornUserId === ownUserId));
}

export async function saveMemberIntel(faction: Faction, value: MemberIntel): Promise<void> {
  const record = memberIntelSchema.parse(value);
  if (record.factionId !== faction.id) throw new Error("The shared data belongs to a different faction.");
  const key = `${prefix}${record.tornUserId}`;
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await db.$transaction(async (tx) => {
      const tenant = await tx.faction.upsert({ where: { tornFactionId: faction.id }, update: {}, create: { tornFactionId: faction.id, name: faction.name, tag: faction.tag } });
      await tx.factionSetting.upsert({ where: { factionId_key: { factionId: tenant.id, key } },
        create: { factionId: tenant.id, key, value: record as unknown as Prisma.InputJsonValue }, update: { value: record as unknown as Prisma.InputJsonValue } });
    });
  } else {
    const database = openLocalDatabase();
    if (!database) throw new Error("Create storage in Settings before sharing OC data.");
    try { database.prepare("INSERT INTO faction_settings (faction_id, key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(faction_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
      .run(faction.id, key, JSON.stringify(record), new Date().toISOString()); }
    finally { database.close(); }
  }
}

export async function deleteMemberIntel(factionId: number, tornUserId: number): Promise<void> {
  const key = `${prefix}${tornUserId}`;
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await db.factionSetting.deleteMany({ where: { faction: { tornFactionId: factionId }, key } });
  } else {
    const database = openLocalDatabase();
    if (!database) throw new Error("The OC store is unavailable.");
    try { database.prepare("DELETE FROM faction_settings WHERE faction_id = ? AND key = ?").run(factionId, key); }
    finally { database.close(); }
  }
}

const defaultSharePref: OcSharePreference = { autoShare: false, lastAutoShareAt: null };

export async function readOcSharePreference(factionId: number, tornUserId: number): Promise<OcSharePreference> {
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
  const parsed = ocSharePreferenceSchema.safeParse(raw);
  return parsed.success ? { autoShare: parsed.data.autoShare, lastAutoShareAt: parsed.data.lastAutoShareAt ?? null } : defaultSharePref;
}

export async function writeOcSharePreference(faction: Faction, tornUserId: number, value: OcSharePreference): Promise<void> {
  const record = ocSharePreferenceSchema.parse(value);
  const key = `${prefPrefix}${tornUserId}`;
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await db.$transaction(async (tx) => {
      const tenant = await tx.faction.upsert({ where: { tornFactionId: faction.id }, update: {}, create: { tornFactionId: faction.id, name: faction.name, tag: faction.tag } });
      await tx.factionSetting.upsert({ where: { factionId_key: { factionId: tenant.id, key } },
        create: { factionId: tenant.id, key, value: record as unknown as Prisma.InputJsonValue }, update: { value: record as unknown as Prisma.InputJsonValue } });
    });
  } else {
    const database = openLocalDatabase();
    if (!database) throw new Error("Create storage in Settings before changing sharing preferences.");
    try { database.prepare("INSERT INTO faction_settings (faction_id, key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(faction_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
      .run(faction.id, key, JSON.stringify(record), new Date().toISOString()); }
    finally { database.close(); }
  }
}

const defaultSettings: OcReviewSettings = { minimumCpr: DEFAULT_MINIMUM_CPR };

export async function readOcReviewSettings(factionId: number): Promise<OcReviewSettings> {
  let raw: unknown;
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    const row = await db.factionSetting.findFirst({ where: { faction: { tornFactionId: factionId }, key: settingsKey }, select: { value: true } });
    raw = row?.value;
  } else {
    const database = openLocalDatabase();
    if (!database) return defaultSettings;
    try {
      const row = database.prepare("SELECT value_json FROM faction_settings WHERE faction_id = ? AND key = ?").get(factionId, settingsKey) as { value_json: string } | undefined;
      raw = row ? (JSON.parse(row.value_json) as unknown) : undefined;
    } catch { return defaultSettings; }
    finally { database.close(); }
  }
  const parsed = ocReviewSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultSettings;
}

export async function writeOcReviewSettings(faction: Faction, value: OcReviewSettings): Promise<void> {
  const record = ocReviewSettingsSchema.parse(value);
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await db.$transaction(async (tx) => {
      const tenant = await tx.faction.upsert({ where: { tornFactionId: faction.id }, update: {}, create: { tornFactionId: faction.id, name: faction.name, tag: faction.tag } });
      await tx.factionSetting.upsert({ where: { factionId_key: { factionId: tenant.id, key: settingsKey } },
        create: { factionId: tenant.id, key: settingsKey, value: record as unknown as Prisma.InputJsonValue }, update: { value: record as unknown as Prisma.InputJsonValue } });
    });
  } else {
    const database = openLocalDatabase();
    if (!database) throw new Error("Create storage in Settings before tuning OC review.");
    try { database.prepare("INSERT INTO faction_settings (faction_id, key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(faction_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
      .run(faction.id, settingsKey, JSON.stringify(record), new Date().toISOString()); }
    finally { database.close(); }
  }
}
