import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { cache } from "react";
import { localDatabaseExists, openLocalDatabase } from "@/lib/data/local-database";
import { awardCitationError, isMemberBadgeId, type MemberBadgeId } from "@/lib/members/member-badges";

export type MemberReportCategory = "RECOGNITION" | "DEVELOPMENT" | "INCIDENT" | "GENERAL";
export type MemberReportVisibility = "FACTION" | "LEADERSHIP";

export interface MemberReportEntry {
  id: string;
  tornUserId: number;
  memberName: string;
  category: MemberReportCategory;
  visibility: MemberReportVisibility;
  title: string;
  body: string;
  authorTornUserId: number;
  authorName: string;
  createdAt: string;
}

export interface MemberAward {
  id: string;
  tornUserId: number;
  memberName: string;
  badgeId: MemberBadgeId;
  citation: string;
  awardedByTornUserId: number;
  awardedByName: string;
  awardedAt: string;
  revokedAt: string | null;
  revokedByTornUserId: number | null;
  revokedByName: string | null;
  revokeReason: string | null;
}

export interface MemberProfileWorkspace {
  databaseConfigured: boolean;
  databaseAvailable: boolean;
  reports: MemberReportEntry[];
  awards: MemberAward[];
  message: string;
}

interface FactionIdentity { id: number; name: string; tag: string }
interface MemberTarget { tornUserId: number; memberName: string }
interface MemberActor { tornUserId: number; name: string; isPlatformAdmin: boolean }
interface NewMemberReport { category: MemberReportCategory; visibility: MemberReportVisibility; title: string; body: string }
interface NewMemberAward { badgeId: MemberBadgeId; citation: string }

export const getMemberProfileWorkspace = cache(async (
  factionId: number | null,
  tornUserId: number,
  includeLeadershipReports: boolean,
): Promise<MemberProfileWorkspace> => {
  const hasPostgres = Boolean(process.env.DATABASE_URL?.trim());
  if (!hasPostgres && !localDatabaseExists()) return empty(false, false, "Create local storage in Settings to keep member reports and awards.");
  if (!factionId) return empty(true, true, "Connect a verified faction to view member records.");
  return hasPostgres
    ? getPostgresWorkspace(factionId, tornUserId, includeLeadershipReports)
    : getLocalWorkspace(factionId, tornUserId, includeLeadershipReports);
});

export async function createMemberReport(
  faction: FactionIdentity,
  target: MemberTarget,
  actor: MemberActor,
  input: NewMemberReport,
): Promise<void> {
  const report: MemberReportEntry = {
    id: randomUUID(),
    tornUserId: target.tornUserId,
    memberName: target.memberName,
    category: input.category,
    visibility: input.visibility,
    title: input.title,
    body: input.body,
    authorTornUserId: actor.tornUserId,
    authorName: actor.name,
    createdAt: new Date().toISOString(),
  };
  if (process.env.DATABASE_URL?.trim()) await createPostgresRecord(faction, actor, reportKey(target.tornUserId, report.id), report, "member_report.created", "MemberReport", report.id);
  else createLocalRecord(faction.id, reportKey(target.tornUserId, report.id), report, "Create local storage before writing member reports.");
}

export async function assignMemberAward(
  faction: FactionIdentity,
  target: MemberTarget,
  actor: MemberActor,
  input: NewMemberAward,
): Promise<void> {
  if (!isMemberBadgeId(input.badgeId)) throw new Error("Choose a valid faction distinction.");
  const citationError = awardCitationError(input.citation);
  if (citationError) throw new Error(citationError);
  const award: MemberAward = {
    id: randomUUID(),
    tornUserId: target.tornUserId,
    memberName: target.memberName,
    badgeId: input.badgeId,
    citation: input.citation.trim(),
    awardedByTornUserId: actor.tornUserId,
    awardedByName: actor.name,
    awardedAt: new Date().toISOString(),
    revokedAt: null,
    revokedByTornUserId: null,
    revokedByName: null,
    revokeReason: null,
  };
  if (process.env.DATABASE_URL?.trim()) await createPostgresRecord(faction, actor, awardKey(target.tornUserId, award.id), award, "member_award.assigned", "MemberAward", award.id);
  else createLocalRecord(faction.id, awardKey(target.tornUserId, award.id), award, "Create local storage before assigning member awards.");
}

export async function revokeMemberAward(
  faction: FactionIdentity,
  target: MemberTarget,
  actor: MemberActor,
  awardId: string,
  reason: string,
): Promise<void> {
  if (process.env.DATABASE_URL?.trim()) {
    await revokePostgresAward(faction, target, actor, awardId, reason);
    return;
  }
  revokeLocalAward(faction.id, target, actor, awardId, reason);
}

function getLocalWorkspace(factionId: number, tornUserId: number, includeLeadershipReports: boolean): MemberProfileWorkspace {
  const database = openLocalDatabase();
  if (!database) return empty(false, false, "The local member record store is unavailable.");
  try {
    const rows = database.prepare("SELECT key, value_json FROM faction_settings WHERE faction_id = ? AND (key LIKE ? OR key LIKE ?) ORDER BY updated_at DESC").all(factionId, `${reportPrefix(tornUserId)}%`, `${awardPrefix(tornUserId)}%`) as unknown as LocalSettingRow[];
    return workspaceFromSettings(rows.map((row) => ({ key: row.key, value: safeJson(row.value_json) })), includeLeadershipReports);
  } catch {
    return empty(true, false, "The local member record store could not be read safely.");
  } finally {
    database.close();
  }
}

async function getPostgresWorkspace(factionId: number, tornUserId: number, includeLeadershipReports: boolean): Promise<MemberProfileWorkspace> {
  try {
    const { db } = await import("@/lib/db");
    const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
    if (!faction) return empty(true, true, "No Chainward reports or awards have been recorded for this member.");
    const settings = await db.factionSetting.findMany({
      where: { factionId: faction.id, OR: [{ key: { startsWith: reportPrefix(tornUserId) } }, { key: { startsWith: awardPrefix(tornUserId) } }] },
      orderBy: { updatedAt: "desc" },
    });
    return workspaceFromSettings(settings.map((setting) => ({ key: setting.key, value: setting.value })), includeLeadershipReports);
  } catch {
    return empty(true, false, "The configured member record store could not be queried.");
  }
}

function workspaceFromSettings(settings: Array<{ key: string; value: unknown }>, includeLeadershipReports: boolean): MemberProfileWorkspace {
  const reports = settings
    .filter((setting) => setting.key.startsWith("members.report."))
    .flatMap((setting) => { const report = parseReport(setting.value); return report && (includeLeadershipReports || report.visibility === "FACTION") ? [report] : []; })
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const awards = settings
    .filter((setting) => setting.key.startsWith("members.award."))
    .flatMap((setting) => { const award = parseAward(setting.value); return award ? [award] : []; })
    .toSorted((left, right) => right.awardedAt.localeCompare(left.awardedAt));
  const activeAwardCount = awards.filter((award) => !award.revokedAt).length;
  const recordCount = reports.length + activeAwardCount;
  return { databaseConfigured: true, databaseAvailable: true, reports, awards, message: recordCount ? `${recordCount} active Chainward record${recordCount === 1 ? "" : "s"} for this member.` : "No Chainward reports or awards have been recorded for this member." };
}

function createLocalRecord(factionId: number, key: string, value: MemberReportEntry | MemberAward, unavailableMessage: string): void {
  const database = openLocalDatabase();
  if (!database) throw new Error(unavailableMessage);
  let transactionStarted = false;
  try {
    if ("badgeId" in value) {
      // Check and insert under one write lock, including requests from other
      // processes. A preflight read alone allows simultaneous duplicate awards.
      database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const rows = database.prepare("SELECT value_json FROM faction_settings WHERE faction_id = ? AND key LIKE ?").all(factionId, `${awardPrefix(value.tornUserId)}%`) as unknown as Array<{ value_json: string }>;
      assertAwardAvailable(rows.map((row) => safeJson(row.value_json)), value);
    }
    database.prepare("INSERT INTO faction_settings (faction_id, key, value_json, updated_at) VALUES (?, ?, ?, ?)").run(factionId, key, JSON.stringify(value), new Date().toISOString());
    if (transactionStarted) database.exec("COMMIT");
  } catch (error) {
    if (transactionStarted) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

function revokeLocalAward(factionId: number, target: MemberTarget, actor: MemberActor, awardId: string, reason: string): void {
  const database = openLocalDatabase();
  if (!database) throw new Error("Create local storage before changing member awards.");
  const key = awardKey(target.tornUserId, awardId);
  let transactionStarted = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    const row = database.prepare("SELECT value_json FROM faction_settings WHERE faction_id = ? AND key = ?").get(factionId, key) as unknown as { value_json: string } | undefined;
    const award = row ? parseAward(safeJson(row.value_json)) : null;
    if (!award || award.tornUserId !== target.tornUserId) throw new Error("That award could not be found in this faction workspace.");
    if (award.revokedAt) throw new Error("That award has already been revoked.");
    const next: MemberAward = { ...award, revokedAt: new Date().toISOString(), revokedByTornUserId: actor.tornUserId, revokedByName: actor.name, revokeReason: reason };
    database.prepare("UPDATE faction_settings SET value_json = ?, updated_at = ? WHERE faction_id = ? AND key = ?").run(JSON.stringify(next), next.revokedAt, factionId, key);
    database.exec("COMMIT");
  } catch (error) {
    if (transactionStarted) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

async function createPostgresRecord(
  factionIdentity: FactionIdentity,
  actor: MemberActor,
  key: string,
  value: MemberReportEntry | MemberAward,
  action: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  const { db } = await import("@/lib/db");
  const jsonValue = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  await db.$transaction(async (transaction) => {
    const faction = await transaction.faction.upsert({ where: { tornFactionId: factionIdentity.id }, update: { name: factionIdentity.name, tag: factionIdentity.tag }, create: { tornFactionId: factionIdentity.id, name: factionIdentity.name, tag: factionIdentity.tag } });
    if ("badgeId" in value) {
      // Serialise award changes within this faction before checking its ledger.
      await transaction.$queryRaw`SELECT id FROM "Faction" WHERE id = ${faction.id}::uuid FOR UPDATE`;
      const existing = await transaction.factionSetting.findMany({ where: { factionId: faction.id, key: { startsWith: awardPrefix(value.tornUserId) } }, select: { value: true } });
      assertAwardAvailable(existing.map((setting) => setting.value), value);
    }
    const actorUser = await transaction.user.upsert({ where: { tornUserId: actor.tornUserId }, update: { name: actor.name, isPlatformAdmin: actor.isPlatformAdmin }, create: { tornUserId: actor.tornUserId, name: actor.name, isPlatformAdmin: actor.isPlatformAdmin } });
    await transaction.factionSetting.create({ data: { factionId: faction.id, key, value: jsonValue } });
    await transaction.auditLog.create({ data: { factionId: faction.id, actorId: actorUser.id, action, entityType, entityId, metadata: jsonValue } });
  });
}

async function revokePostgresAward(factionIdentity: FactionIdentity, target: MemberTarget, actor: MemberActor, awardId: string, reason: string): Promise<void> {
  const { db } = await import("@/lib/db");
  await db.$transaction(async (transaction) => {
    const faction = await transaction.faction.findUnique({ where: { tornFactionId: factionIdentity.id } });
    if (!faction) throw new Error("That award could not be found in this faction workspace.");
    await transaction.$queryRaw`SELECT id FROM "Faction" WHERE id = ${faction.id}::uuid FOR UPDATE`;
    const key = awardKey(target.tornUserId, awardId);
    const setting = await transaction.factionSetting.findUnique({ where: { factionId_key: { factionId: faction.id, key } } });
    const award = setting ? parseAward(setting.value) : null;
    if (!award || award.tornUserId !== target.tornUserId) throw new Error("That award could not be found in this faction workspace.");
    if (award.revokedAt) throw new Error("That award has already been revoked.");
    const actorUser = await transaction.user.upsert({ where: { tornUserId: actor.tornUserId }, update: { name: actor.name, isPlatformAdmin: actor.isPlatformAdmin }, create: { tornUserId: actor.tornUserId, name: actor.name, isPlatformAdmin: actor.isPlatformAdmin } });
    const next: MemberAward = { ...award, revokedAt: new Date().toISOString(), revokedByTornUserId: actor.tornUserId, revokedByName: actor.name, revokeReason: reason };
    const jsonValue = JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue;
    await transaction.factionSetting.update({ where: { id: setting!.id }, data: { value: jsonValue } });
    await transaction.auditLog.create({ data: { factionId: faction.id, actorId: actorUser.id, action: "member_award.revoked", entityType: "MemberAward", entityId: award.id, metadata: jsonValue } });
  });
}

function reportPrefix(tornUserId: number): string { return `members.report.${tornUserId}.`; }
function awardPrefix(tornUserId: number): string { return `members.award.${tornUserId}.`; }
function reportKey(tornUserId: number, id: string): string { return `${reportPrefix(tornUserId)}${id}`; }
function awardKey(tornUserId: number, id: string): string { return `${awardPrefix(tornUserId)}${id}`; }
function assertAwardAvailable(values: unknown[], next: MemberAward): void {
  if (values.some((value) => {
    const award = parseAward(value);
    return award && award.tornUserId === next.tornUserId && award.badgeId === next.badgeId && !award.revokedAt;
  })) throw new Error(`${next.memberName} already has this active badge.`);
}
function safeJson(value: string): unknown { try { return JSON.parse(value) as unknown; } catch { return null; } }
function empty(databaseConfigured: boolean, databaseAvailable: boolean, message: string): MemberProfileWorkspace { return { databaseConfigured, databaseAvailable, reports: [], awards: [], message }; }

function parseReport(value: unknown): MemberReportEntry | null {
  if (!value || typeof value !== "object") return null;
  const report = value as Record<string, unknown>;
  if (typeof report.id !== "string" || typeof report.tornUserId !== "number" || typeof report.memberName !== "string" || !isReportCategory(report.category) || !isReportVisibility(report.visibility) || typeof report.title !== "string" || typeof report.body !== "string" || typeof report.authorTornUserId !== "number" || typeof report.authorName !== "string" || typeof report.createdAt !== "string") return null;
  return report as unknown as MemberReportEntry;
}

function parseAward(value: unknown): MemberAward | null {
  if (!value || typeof value !== "object") return null;
  const award = value as Record<string, unknown>;
  if (typeof award.id !== "string" || typeof award.tornUserId !== "number" || typeof award.memberName !== "string" || !isMemberBadgeId(award.badgeId) || typeof award.citation !== "string" || typeof award.awardedByTornUserId !== "number" || typeof award.awardedByName !== "string" || typeof award.awardedAt !== "string" || !isNullableString(award.revokedAt) || !isNullableNumber(award.revokedByTornUserId) || !isNullableString(award.revokedByName) || !isNullableString(award.revokeReason)) return null;
  return award as unknown as MemberAward;
}

function isReportCategory(value: unknown): value is MemberReportCategory { return value === "RECOGNITION" || value === "DEVELOPMENT" || value === "INCIDENT" || value === "GENERAL"; }
function isReportVisibility(value: unknown): value is MemberReportVisibility { return value === "FACTION" || value === "LEADERSHIP"; }
function isNullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function isNullableNumber(value: unknown): value is number | null { return value === null || typeof value === "number"; }
interface LocalSettingRow { key: string; value_json: string }
