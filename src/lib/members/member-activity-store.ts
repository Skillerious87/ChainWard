import "server-only";

import { cache } from "react";
import { localDatabaseExists, openLocalDatabase } from "@/lib/data/local-database";

export type ManagedMemberActivityState = "HOLIDAY" | "WATCH";
export type MemberActivityInputState = ManagedMemberActivityState | "STANDARD";

export interface MemberActivityPolicy {
  thresholdDays: number;
  updatedByTornId: number | null;
  updatedByName: string | null;
  updatedAt: string | null;
}

export const DEFAULT_MEMBER_ACTIVITY_POLICY: MemberActivityPolicy = {
  thresholdDays: 3,
  updatedByTornId: null,
  updatedByName: null,
  updatedAt: null,
};

export interface MemberActivityRecord {
  tornUserId: number;
  memberName: string;
  state: ManagedMemberActivityState;
  holidayUntil: string | null;
  note: string;
  updatedByTornId: number;
  updatedByName: string;
  updatedAt: string;
}

export interface MemberActivityAuditEvent {
  id: string;
  tornUserId: number;
  memberName: string;
  action: "HOLIDAY_SET" | "WATCH_SET" | "UPDATED" | "CLEARED";
  state: MemberActivityInputState;
  holidayUntil: string | null;
  note: string;
  actorTornUserId: number;
  actorName: string;
  createdAt: string;
}

export interface MemberActivityWorkspace {
  databaseConfigured: boolean;
  databaseAvailable: boolean;
  policy: MemberActivityPolicy;
  records: MemberActivityRecord[];
  audit: MemberActivityAuditEvent[];
  message: string;
}

interface FactionIdentity { id: number; name: string; tag: string }
interface ActivityTarget { tornUserId: number; memberName: string }
interface ActivityActor { tornUserId: number; name: string; isPlatformAdmin: boolean }
interface ActivityUpdate { state: MemberActivityInputState; holidayUntil: string | null; note: string }

export const getMemberActivityWorkspace = cache(async (factionId: number | null): Promise<MemberActivityWorkspace> => {
  const hasPostgres = Boolean(process.env.DATABASE_URL?.trim());
  if (!hasPostgres && !localDatabaseExists()) return empty(false, false, "Create local storage in Settings to manage holiday and watch records.");
  if (!factionId) return empty(true, true, "Connect a verified faction to manage member activity.");
  return hasPostgres ? getPostgresWorkspace(factionId) : getLocalWorkspace(factionId);
});

export async function setMemberActivity(
  faction: FactionIdentity,
  target: ActivityTarget,
  actor: ActivityActor,
  update: ActivityUpdate,
): Promise<void> {
  if (process.env.DATABASE_URL?.trim()) {
    await setPostgresActivity(faction, target, actor, update);
    return;
  }
  setLocalActivity(faction.id, target, actor, update);
}

export async function setMemberActivityPolicy(faction: FactionIdentity, actor: ActivityActor, thresholdDays: number): Promise<void> {
  if (!Number.isInteger(thresholdDays) || thresholdDays < 1 || thresholdDays > 30) throw new Error("Choose an inactivity threshold between 1 and 30 days.");
  if (process.env.DATABASE_URL?.trim()) {
    await setPostgresPolicy(faction, actor, thresholdDays);
    return;
  }
  setLocalPolicy(faction.id, actor, thresholdDays);
}

function getLocalWorkspace(factionId: number): MemberActivityWorkspace {
  const database = openLocalDatabase();
  if (!database) return empty(false, false, "The local activity register is unavailable.");
  try {
    const rows = database.prepare("SELECT key, value_json FROM faction_settings WHERE faction_id = ? AND key LIKE 'members.activity.%' ORDER BY key").all(factionId) as unknown as LocalSettingRow[];
    const policyRow = database.prepare("SELECT value_json FROM faction_settings WHERE faction_id = ? AND key = 'members.policy'").get(factionId) as unknown as { value_json: string } | undefined;
    const records = rows.flatMap((row) => { const record = parseRecord(safeJson(row.value_json)); return record ? [record] : []; });
    const audit = (database.prepare("SELECT * FROM member_activity_audit WHERE faction_id = ? ORDER BY created_at DESC, id DESC LIMIT 30").all(factionId) as unknown as LocalAuditRow[]).map(mapLocalAudit);
    return { databaseConfigured: true, databaseAvailable: true, policy: parsePolicy(policyRow ? safeJson(policyRow.value_json) : null), records, audit, message: records.length ? `${records.length} managed member activity record${records.length === 1 ? "" : "s"}.` : "No holiday or watch records have been created." };
  } catch {
    return empty(true, false, "The local member activity register could not be read safely.");
  } finally { database.close(); }
}

function setLocalPolicy(factionId: number, actor: ActivityActor, thresholdDays: number): void {
  const database = openLocalDatabase();
  if (!database) throw new Error("Create local storage before managing the activity policy.");
  const now = new Date().toISOString();
  const policy: MemberActivityPolicy = { thresholdDays, updatedByTornId: actor.tornUserId, updatedByName: actor.name, updatedAt: now };
  try {
    database.exec("BEGIN IMMEDIATE");
    database.prepare("INSERT INTO faction_settings (faction_id, key, value_json, updated_at) VALUES (?, 'members.policy', ?, ?) ON CONFLICT(faction_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at").run(factionId, JSON.stringify(policy), now);
    database.prepare("INSERT INTO member_activity_audit (faction_id, torn_user_id, member_name, action, state, holiday_until, note, actor_torn_user_id, actor_name, created_at) VALUES (?, 0, 'Faction activity policy', 'UPDATED', 'STANDARD', NULL, ?, ?, ?, ?)").run(factionId, `Inactivity alert threshold changed to ${thresholdDays} days.`, actor.tornUserId, actor.name, now);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction did not begin. */ }
    throw error;
  } finally { database.close(); }
}

function setLocalActivity(factionId: number, target: ActivityTarget, actor: ActivityActor, update: ActivityUpdate): void {
  const database = openLocalDatabase();
  if (!database) throw new Error("Create local storage before managing member activity.");
  const now = new Date().toISOString();
  const key = activityKey(target.tornUserId);
  try {
    database.exec("BEGIN IMMEDIATE");
    const previous = database.prepare("SELECT value_json FROM faction_settings WHERE faction_id = ? AND key = ?").get(factionId, key) as unknown as { value_json: string } | undefined;
    if (update.state === "STANDARD") {
      database.prepare("DELETE FROM faction_settings WHERE faction_id = ? AND key = ?").run(factionId, key);
    } else {
      const record: MemberActivityRecord = { tornUserId: target.tornUserId, memberName: target.memberName, state: update.state, holidayUntil: update.state === "HOLIDAY" ? update.holidayUntil : null, note: update.note, updatedByTornId: actor.tornUserId, updatedByName: actor.name, updatedAt: now };
      database.prepare("INSERT INTO faction_settings (faction_id, key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(faction_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at").run(factionId, key, JSON.stringify(record), now);
    }
    const action = update.state === "STANDARD" ? "CLEARED" : previous ? "UPDATED" : update.state === "HOLIDAY" ? "HOLIDAY_SET" : "WATCH_SET";
    database.prepare("INSERT INTO member_activity_audit (faction_id, torn_user_id, member_name, action, state, holiday_until, note, actor_torn_user_id, actor_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(factionId, target.tornUserId, target.memberName, action, update.state, update.state === "HOLIDAY" ? update.holidayUntil : null, update.note, actor.tornUserId, actor.name, now);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction did not begin. */ }
    throw error;
  } finally { database.close(); }
}

async function getPostgresWorkspace(factionId: number): Promise<MemberActivityWorkspace> {
  try {
    const { db } = await import("@/lib/db");
    const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
    if (!faction) return empty(true, true, "No holiday or watch records have been created.");
    const [settings, events] = await Promise.all([
      db.factionSetting.findMany({ where: { factionId: faction.id, key: { startsWith: "members." } }, orderBy: { key: "asc" } }),
      db.auditLog.findMany({ where: { factionId: faction.id, action: { startsWith: "member_activity." } }, include: { actor: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    ]);
    const policy = parsePolicy(settings.find((setting) => setting.key === "members.policy")?.value ?? null);
    const records = settings.filter((setting) => setting.key.startsWith("members.activity.")).flatMap((setting) => { const record = parseRecord(setting.value); return record ? [record] : []; });
    const audit = events.flatMap<MemberActivityAuditEvent>((event) => { const parsed = parseAudit(event.metadata); return parsed ? [{ ...parsed, id: event.id, actorTornUserId: event.actor?.tornUserId ?? parsed.actorTornUserId, actorName: event.actor?.name ?? parsed.actorName, createdAt: event.createdAt.toISOString() }] : []; });
    return { databaseConfigured: true, databaseAvailable: true, policy, records, audit, message: records.length ? `${records.length} managed member activity record${records.length === 1 ? "" : "s"}.` : "No holiday or watch records have been created." };
  } catch {
    return empty(true, false, "The configured member activity register could not be queried.");
  }
}

async function setPostgresPolicy(factionIdentity: FactionIdentity, actor: ActivityActor, thresholdDays: number): Promise<void> {
  const { db } = await import("@/lib/db");
  const now = new Date();
  await db.$transaction(async (transaction) => {
    const faction = await transaction.faction.upsert({ where: { tornFactionId: factionIdentity.id }, update: { name: factionIdentity.name, tag: factionIdentity.tag }, create: { tornFactionId: factionIdentity.id, name: factionIdentity.name, tag: factionIdentity.tag } });
    const actorUser = await transaction.user.upsert({ where: { tornUserId: actor.tornUserId }, update: { name: actor.name, isPlatformAdmin: actor.isPlatformAdmin }, create: { tornUserId: actor.tornUserId, name: actor.name, isPlatformAdmin: actor.isPlatformAdmin } });
    const policy = { thresholdDays, updatedByTornId: actor.tornUserId, updatedByName: actor.name, updatedAt: now.toISOString() };
    await transaction.factionSetting.upsert({ where: { factionId_key: { factionId: faction.id, key: "members.policy" } }, update: { value: policy }, create: { factionId: faction.id, key: "members.policy", value: policy } });
    await transaction.auditLog.create({ data: { factionId: faction.id, actorId: actorUser.id, action: "member_activity.policy_updated", entityType: "FactionActivityPolicy", entityId: String(factionIdentity.id), metadata: { tornUserId: 0, memberName: "Faction activity policy", action: "UPDATED", state: "STANDARD", holidayUntil: null, note: `Inactivity alert threshold changed to ${thresholdDays} days.`, actorTornUserId: actor.tornUserId, actorName: actor.name } } });
  });
}

async function setPostgresActivity(factionIdentity: FactionIdentity, target: ActivityTarget, actor: ActivityActor, update: ActivityUpdate): Promise<void> {
  const { db } = await import("@/lib/db");
  const now = new Date();
  await db.$transaction(async (transaction) => {
    const faction = await transaction.faction.upsert({ where: { tornFactionId: factionIdentity.id }, update: { name: factionIdentity.name, tag: factionIdentity.tag }, create: { tornFactionId: factionIdentity.id, name: factionIdentity.name, tag: factionIdentity.tag } });
    const actorUser = await transaction.user.upsert({ where: { tornUserId: actor.tornUserId }, update: { name: actor.name, isPlatformAdmin: actor.isPlatformAdmin }, create: { tornUserId: actor.tornUserId, name: actor.name, isPlatformAdmin: actor.isPlatformAdmin } });
    const key = activityKey(target.tornUserId);
    const previous = await transaction.factionSetting.findUnique({ where: { factionId_key: { factionId: faction.id, key } } });
    if (update.state === "STANDARD") {
      if (previous) await transaction.factionSetting.delete({ where: { id: previous.id } });
    } else {
      const record = { tornUserId: target.tornUserId, memberName: target.memberName, state: update.state, holidayUntil: update.state === "HOLIDAY" ? update.holidayUntil : null, note: update.note, updatedByTornId: actor.tornUserId, updatedByName: actor.name, updatedAt: now.toISOString() };
      await transaction.factionSetting.upsert({ where: { factionId_key: { factionId: faction.id, key } }, update: { value: record }, create: { factionId: faction.id, key, value: record } });
    }
    const action = update.state === "STANDARD" ? "CLEARED" : previous ? "UPDATED" : update.state === "HOLIDAY" ? "HOLIDAY_SET" : "WATCH_SET";
    await transaction.auditLog.create({ data: { factionId: faction.id, actorId: actorUser.id, action: `member_activity.${action.toLowerCase()}`, entityType: "FactionMember", entityId: String(target.tornUserId), metadata: { tornUserId: target.tornUserId, memberName: target.memberName, action, state: update.state, holidayUntil: update.state === "HOLIDAY" ? update.holidayUntil : null, note: update.note, actorTornUserId: actor.tornUserId, actorName: actor.name } } });
  });
}

function activityKey(tornUserId: number): string { return `members.activity.${tornUserId}`; }
function empty(databaseConfigured: boolean, databaseAvailable: boolean, message: string): MemberActivityWorkspace { return { databaseConfigured, databaseAvailable, policy: DEFAULT_MEMBER_ACTIVITY_POLICY, records: [], audit: [], message }; }
function safeJson(value: string): unknown { try { return JSON.parse(value) as unknown; } catch { return null; } }

function parseRecord(value: unknown): MemberActivityRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.tornUserId !== "number" || typeof record.memberName !== "string" || (record.state !== "HOLIDAY" && record.state !== "WATCH") || (record.holidayUntil !== null && typeof record.holidayUntil !== "string") || typeof record.note !== "string" || typeof record.updatedByTornId !== "number" || typeof record.updatedByName !== "string" || typeof record.updatedAt !== "string") return null;
  return record as unknown as MemberActivityRecord;
}

function parsePolicy(value: unknown): MemberActivityPolicy {
  if (!value || typeof value !== "object") return DEFAULT_MEMBER_ACTIVITY_POLICY;
  const policy = value as Record<string, unknown>;
  if (typeof policy.thresholdDays !== "number" || !Number.isInteger(policy.thresholdDays) || policy.thresholdDays < 1 || policy.thresholdDays > 30) return DEFAULT_MEMBER_ACTIVITY_POLICY;
  return {
    thresholdDays: policy.thresholdDays,
    updatedByTornId: typeof policy.updatedByTornId === "number" ? policy.updatedByTornId : null,
    updatedByName: typeof policy.updatedByName === "string" ? policy.updatedByName : null,
    updatedAt: typeof policy.updatedAt === "string" ? policy.updatedAt : null,
  };
}

function parseAudit(value: unknown): Omit<MemberActivityAuditEvent, "id" | "createdAt"> | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (typeof event.tornUserId !== "number" || typeof event.memberName !== "string" || !isAction(event.action) || !isInputState(event.state) || (event.holidayUntil !== null && typeof event.holidayUntil !== "string") || typeof event.note !== "string" || typeof event.actorTornUserId !== "number" || typeof event.actorName !== "string") return null;
  return event as unknown as Omit<MemberActivityAuditEvent, "id" | "createdAt">;
}

function isAction(value: unknown): value is MemberActivityAuditEvent["action"] { return value === "HOLIDAY_SET" || value === "WATCH_SET" || value === "UPDATED" || value === "CLEARED"; }
function isInputState(value: unknown): value is MemberActivityInputState { return value === "HOLIDAY" || value === "WATCH" || value === "STANDARD"; }
function mapLocalAudit(row: LocalAuditRow): MemberActivityAuditEvent { return { id: String(row.id), tornUserId: row.torn_user_id, memberName: row.member_name, action: row.action, state: row.state, holidayUntil: row.holiday_until, note: row.note, actorTornUserId: row.actor_torn_user_id, actorName: row.actor_name, createdAt: row.created_at }; }

interface LocalSettingRow { key: string; value_json: string }
interface LocalAuditRow { id: number; torn_user_id: number; member_name: string; action: MemberActivityAuditEvent["action"]; state: MemberActivityInputState; holiday_until: string | null; note: string; actor_torn_user_id: number; actor_name: string; created_at: string }
