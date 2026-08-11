import "server-only";

import { localDatabaseExists, openLocalDatabase } from "@/lib/data/local-database";

export type ManagedFactionRole = "ADMINISTRATOR" | "CHAIN_MANAGER" | "VIEWER";
export type ManagedAccessStatus = "ACTIVE" | "SUSPENDED";

export interface FactionAccessAssignment {
  tornUserId: number;
  memberName: string;
  role: ManagedFactionRole;
  status: ManagedAccessStatus;
  assignedByTornId: number;
  updatedAt: string;
}

export interface FactionAccessAuditEvent {
  id: string;
  tornUserId: number;
  memberName: string;
  action: "GRANTED" | "UPDATED" | "SUSPENDED" | "REVOKED";
  role: ManagedFactionRole;
  status: ManagedAccessStatus | "REMOVED";
  actorTornUserId: number;
  createdAt: string;
}

export interface FactionAccessWorkspace {
  databaseConfigured: boolean;
  databaseAvailable: boolean;
  assignments: FactionAccessAssignment[];
  audit: FactionAccessAuditEvent[];
  message: string;
}

interface FactionIdentity {
  id: number;
  name: string;
  tag: string;
}

interface AccessTarget {
  tornUserId: number;
  memberName: string;
}

export async function getFactionAccessWorkspace(factionId: number | null): Promise<FactionAccessWorkspace> {
  const hasPostgres = Boolean(process.env.DATABASE_URL?.trim());
  if (!hasPostgres && !localDatabaseExists()) return empty(false, false, "Create local storage in Settings before assigning application access.");
  if (!factionId) return empty(true, true, "Connect a verified faction to manage workspace access.");
  return hasPostgres ? getPostgresWorkspace(factionId) : getLocalWorkspace(factionId);
}

export async function setFactionAccess(
  faction: FactionIdentity,
  target: AccessTarget,
  actorTornUserId: number,
  role: ManagedFactionRole,
  status: ManagedAccessStatus,
): Promise<void> {
  if (process.env.DATABASE_URL?.trim()) {
    await setPostgresAccess(faction, target, actorTornUserId, role, status);
    return;
  }
  setLocalAccess(faction.id, target, actorTornUserId, role, status);
}

export async function setFactionAccessBatch(
  faction: FactionIdentity,
  targets: AccessTarget[],
  actorTornUserId: number,
  role: ManagedFactionRole,
  status: ManagedAccessStatus,
): Promise<void> {
  if (!targets.length) return;
  if (process.env.DATABASE_URL?.trim()) {
    await setPostgresAccessBatch(faction, targets, actorTornUserId, role, status);
    return;
  }
  setLocalAccessBatch(faction.id, targets, actorTornUserId, role, status);
}

export async function revokeFactionAccess(
  faction: FactionIdentity,
  target: AccessTarget,
  actorTornUserId: number,
): Promise<void> {
  if (process.env.DATABASE_URL?.trim()) {
    await revokePostgresAccess(faction, target, actorTornUserId);
    return;
  }
  revokeLocalAccess(faction.id, target, actorTornUserId);
}

function getLocalWorkspace(factionId: number): FactionAccessWorkspace {
  const database = openLocalDatabase();
  if (!database) return empty(false, false, "The local database file is unavailable.");
  try {
    // `role NOT IN ('OWNER')` mirrors the PostgreSQL path: owner access is
    // intrinsic to the verified platform identity and is never a stored,
    // editable assignment row.
    const assignments = (database.prepare("SELECT * FROM faction_access_assignments WHERE faction_id = ? AND status != 'REMOVED' AND role != 'OWNER' ORDER BY role, member_name").all(factionId) as unknown as LocalAssignmentRow[]).filter((row) => isManagedRole(row.role)).map(mapLocalAssignment);
    const audit = (database.prepare("SELECT * FROM faction_access_audit WHERE faction_id = ? ORDER BY created_at DESC, id DESC LIMIT 20").all(factionId) as unknown as LocalAuditRow[]).map(mapLocalAudit);
    return {
      databaseConfigured: true,
      databaseAvailable: true,
      assignments,
      audit,
      message: assignments.length ? `${assignments.length} managed workspace access assignment${assignments.length === 1 ? "" : "s"}.` : "No application access roles have been assigned yet.",
    };
  } catch {
    return empty(true, false, "The local access registry could not be read safely.");
  } finally {
    database.close();
  }
}

function setLocalAccess(factionId: number, target: AccessTarget, actorTornUserId: number, role: ManagedFactionRole, status: ManagedAccessStatus): void {
  const database = openLocalDatabase();
  if (!database) throw new Error("Create local storage before assigning workspace access.");
  const now = new Date().toISOString();
  try {
    database.exec("BEGIN IMMEDIATE");
    const previous = database.prepare("SELECT role, status FROM faction_access_assignments WHERE faction_id = ? AND torn_user_id = ?").get(factionId, target.tornUserId) as unknown as { role: ManagedFactionRole; status: string } | undefined;
    database.prepare("INSERT INTO faction_access_assignments (faction_id, torn_user_id, member_name, role, status, assigned_by_torn_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(faction_id, torn_user_id) DO UPDATE SET member_name = excluded.member_name, role = excluded.role, status = excluded.status, assigned_by_torn_id = excluded.assigned_by_torn_id, updated_at = excluded.updated_at").run(factionId, target.tornUserId, target.memberName, role, status, actorTornUserId, now);
    const action = status === "SUSPENDED" ? "SUSPENDED" : previous && previous.status !== "REMOVED" ? "UPDATED" : "GRANTED";
    database.prepare("INSERT INTO faction_access_audit (faction_id, torn_user_id, member_name, action, role, status, actor_torn_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(factionId, target.tornUserId, target.memberName, action, role, status, actorTornUserId, now);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction did not begin. */ }
    throw error;
  } finally {
    database.close();
  }
}

function setLocalAccessBatch(factionId: number, targets: AccessTarget[], actorTornUserId: number, role: ManagedFactionRole, status: ManagedAccessStatus): void {
  const database = openLocalDatabase();
  if (!database) throw new Error("Create local storage before assigning workspace access.");
  const now = new Date().toISOString();
  try {
    database.exec("BEGIN IMMEDIATE");
    const findPrevious = database.prepare("SELECT role, status FROM faction_access_assignments WHERE faction_id = ? AND torn_user_id = ?");
    const upsertAssignment = database.prepare("INSERT INTO faction_access_assignments (faction_id, torn_user_id, member_name, role, status, assigned_by_torn_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(faction_id, torn_user_id) DO UPDATE SET member_name = excluded.member_name, role = excluded.role, status = excluded.status, assigned_by_torn_id = excluded.assigned_by_torn_id, updated_at = excluded.updated_at");
    const insertAudit = database.prepare("INSERT INTO faction_access_audit (faction_id, torn_user_id, member_name, action, role, status, actor_torn_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const target of targets) {
      const previous = findPrevious.get(factionId, target.tornUserId) as unknown as { role: ManagedFactionRole; status: string } | undefined;
      upsertAssignment.run(factionId, target.tornUserId, target.memberName, role, status, actorTornUserId, now);
      const action = status === "SUSPENDED" ? "SUSPENDED" : previous && previous.status !== "REMOVED" ? "UPDATED" : "GRANTED";
      insertAudit.run(factionId, target.tornUserId, target.memberName, action, role, status, actorTornUserId, now);
    }
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction did not begin. */ }
    throw error;
  } finally {
    database.close();
  }
}

function revokeLocalAccess(factionId: number, target: AccessTarget, actorTornUserId: number): void {
  const database = openLocalDatabase();
  if (!database) throw new Error("The local access registry is unavailable.");
  const now = new Date().toISOString();
  try {
    database.exec("BEGIN IMMEDIATE");
    const previous = database.prepare("SELECT role FROM faction_access_assignments WHERE faction_id = ? AND torn_user_id = ? AND status != 'REMOVED'").get(factionId, target.tornUserId) as unknown as { role: ManagedFactionRole } | undefined;
    if (!previous) throw new Error("This member does not have an active application access assignment.");
    database.prepare("UPDATE faction_access_assignments SET status = 'REMOVED', assigned_by_torn_id = ?, updated_at = ? WHERE faction_id = ? AND torn_user_id = ?").run(actorTornUserId, now, factionId, target.tornUserId);
    database.prepare("INSERT INTO faction_access_audit (faction_id, torn_user_id, member_name, action, role, status, actor_torn_user_id, created_at) VALUES (?, ?, ?, 'REVOKED', ?, 'REMOVED', ?, ?)").run(factionId, target.tornUserId, target.memberName, previous.role, actorTornUserId, now);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction did not begin. */ }
    throw error;
  } finally {
    database.close();
  }
}

async function getPostgresWorkspace(factionId: number): Promise<FactionAccessWorkspace> {
  try {
    const { db } = await import("@/lib/db");
    const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
    if (!faction) return empty(true, true, "No application access roles have been assigned yet.");
    const [memberships, events] = await Promise.all([
      db.factionMembership.findMany({ where: { factionId: faction.id, status: { not: "REMOVED" } }, include: { user: true }, orderBy: [{ role: "asc" }, { user: { name: "asc" } }] }),
      db.auditLog.findMany({ where: { factionId: faction.id, action: { startsWith: "faction_access." } }, include: { actor: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    const assignments = memberships.filter((membership) => membership.role !== "OWNER" && membership.status !== "INVITED").map<FactionAccessAssignment>((membership) => ({
      tornUserId: membership.user.tornUserId,
      memberName: membership.user.name,
      role: membership.role as ManagedFactionRole,
      status: membership.status as ManagedAccessStatus,
      assignedByTornId: 0,
      updatedAt: membership.updatedAt.toISOString(),
    }));
    const audit = events.flatMap<FactionAccessAuditEvent>((event) => {
      const metadata = accessMetadata(event.metadata);
      return metadata ? [{ id: event.id, tornUserId: metadata.tornUserId, memberName: metadata.memberName, action: metadata.action, role: metadata.role, status: metadata.status, actorTornUserId: event.actor?.tornUserId ?? 0, createdAt: event.createdAt.toISOString() }] : [];
    });
    return { databaseConfigured: true, databaseAvailable: true, assignments, audit, message: assignments.length ? `${assignments.length} managed workspace access assignment${assignments.length === 1 ? "" : "s"}.` : "No application access roles have been assigned yet." };
  } catch {
    return empty(true, false, "The configured access registry could not be queried.");
  }
}

async function setPostgresAccess(factionIdentity: FactionIdentity, target: AccessTarget, actorTornUserId: number, role: ManagedFactionRole, status: ManagedAccessStatus): Promise<void> {
  const { db } = await import("@/lib/db");
  await db.$transaction(async (transaction) => {
    const faction = await transaction.faction.upsert({ where: { tornFactionId: factionIdentity.id }, update: { name: factionIdentity.name, tag: factionIdentity.tag }, create: { tornFactionId: factionIdentity.id, name: factionIdentity.name, tag: factionIdentity.tag } });
    const user = await transaction.user.upsert({ where: { tornUserId: target.tornUserId }, update: { name: target.memberName }, create: { tornUserId: target.tornUserId, name: target.memberName } });
    const actor = await transaction.user.upsert({ where: { tornUserId: actorTornUserId }, update: {}, create: { tornUserId: actorTornUserId, name: `Torn user ${actorTornUserId}`, isPlatformAdmin: true } });
    const previous = await transaction.factionMembership.findUnique({ where: { factionId_userId: { factionId: faction.id, userId: user.id } } });
    const membership = await transaction.factionMembership.upsert({ where: { factionId_userId: { factionId: faction.id, userId: user.id } }, update: { role, status }, create: { factionId: faction.id, userId: user.id, role, status } });
    const action = status === "SUSPENDED" ? "SUSPENDED" : previous && previous.status !== "REMOVED" ? "UPDATED" : "GRANTED";
    await transaction.auditLog.create({ data: { factionId: faction.id, actorId: actor.id, action: `faction_access.${action.toLowerCase()}`, entityType: "FactionMembership", entityId: membership.id, metadata: { tornUserId: target.tornUserId, memberName: target.memberName, action, role, status } } });
  });
}

async function setPostgresAccessBatch(factionIdentity: FactionIdentity, targets: AccessTarget[], actorTornUserId: number, role: ManagedFactionRole, status: ManagedAccessStatus): Promise<void> {
  const { db } = await import("@/lib/db");
  await db.$transaction(async (transaction) => {
    const faction = await transaction.faction.upsert({ where: { tornFactionId: factionIdentity.id }, update: { name: factionIdentity.name, tag: factionIdentity.tag }, create: { tornFactionId: factionIdentity.id, name: factionIdentity.name, tag: factionIdentity.tag } });
    const actor = await transaction.user.upsert({ where: { tornUserId: actorTornUserId }, update: {}, create: { tornUserId: actorTornUserId, name: `Torn user ${actorTornUserId}`, isPlatformAdmin: true } });
    for (const target of targets) {
      const user = await transaction.user.upsert({ where: { tornUserId: target.tornUserId }, update: { name: target.memberName }, create: { tornUserId: target.tornUserId, name: target.memberName } });
      const previous = await transaction.factionMembership.findUnique({ where: { factionId_userId: { factionId: faction.id, userId: user.id } } });
      const membership = await transaction.factionMembership.upsert({ where: { factionId_userId: { factionId: faction.id, userId: user.id } }, update: { role, status }, create: { factionId: faction.id, userId: user.id, role, status } });
      const action = status === "SUSPENDED" ? "SUSPENDED" : previous && previous.status !== "REMOVED" ? "UPDATED" : "GRANTED";
      await transaction.auditLog.create({ data: { factionId: faction.id, actorId: actor.id, action: `faction_access.${action.toLowerCase()}`, entityType: "FactionMembership", entityId: membership.id, metadata: { tornUserId: target.tornUserId, memberName: target.memberName, action, role, status } } });
    }
  });
}

async function revokePostgresAccess(factionIdentity: FactionIdentity, target: AccessTarget, actorTornUserId: number): Promise<void> {
  const { db } = await import("@/lib/db");
  await db.$transaction(async (transaction) => {
    const faction = await transaction.faction.findUnique({ where: { tornFactionId: factionIdentity.id } });
    const user = await transaction.user.findUnique({ where: { tornUserId: target.tornUserId } });
    if (!faction || !user) throw new Error("This member does not have an application access assignment.");
    const membership = await transaction.factionMembership.findUnique({ where: { factionId_userId: { factionId: faction.id, userId: user.id } } });
    if (!membership || membership.status === "REMOVED" || membership.role === "OWNER") throw new Error("This member does not have a revocable application access assignment.");
    const actor = await transaction.user.upsert({ where: { tornUserId: actorTornUserId }, update: {}, create: { tornUserId: actorTornUserId, name: `Torn user ${actorTornUserId}`, isPlatformAdmin: true } });
    await transaction.factionMembership.update({ where: { id: membership.id }, data: { status: "REMOVED" } });
    await transaction.auditLog.create({ data: { factionId: faction.id, actorId: actor.id, action: "faction_access.revoked", entityType: "FactionMembership", entityId: membership.id, metadata: { tornUserId: target.tornUserId, memberName: target.memberName, action: "REVOKED", role: membership.role, status: "REMOVED" } } });
  });
}

function accessMetadata(value: unknown): Omit<FactionAccessAuditEvent, "id" | "actorTornUserId" | "createdAt"> | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (typeof data.tornUserId !== "number" || typeof data.memberName !== "string" || !isAuditAction(data.action) || !isManagedRole(data.role) || !isAuditStatus(data.status)) return null;
  return { tornUserId: data.tornUserId, memberName: data.memberName, action: data.action, role: data.role, status: data.status };
}

function mapLocalAssignment(row: LocalAssignmentRow): FactionAccessAssignment {
  return { tornUserId: row.torn_user_id, memberName: row.member_name, role: row.role, status: row.status, assignedByTornId: row.assigned_by_torn_id, updatedAt: row.updated_at };
}

function mapLocalAudit(row: LocalAuditRow): FactionAccessAuditEvent {
  return { id: String(row.id), tornUserId: row.torn_user_id, memberName: row.member_name, action: row.action, role: row.role, status: row.status, actorTornUserId: row.actor_torn_user_id, createdAt: row.created_at };
}

function isManagedRole(value: unknown): value is ManagedFactionRole { return value === "ADMINISTRATOR" || value === "CHAIN_MANAGER" || value === "VIEWER"; }
function isAuditAction(value: unknown): value is FactionAccessAuditEvent["action"] { return value === "GRANTED" || value === "UPDATED" || value === "SUSPENDED" || value === "REVOKED"; }
function isAuditStatus(value: unknown): value is FactionAccessAuditEvent["status"] { return value === "ACTIVE" || value === "SUSPENDED" || value === "REMOVED"; }
function empty(databaseConfigured: boolean, databaseAvailable: boolean, message: string): FactionAccessWorkspace { return { databaseConfigured, databaseAvailable, assignments: [], audit: [], message }; }

interface LocalAssignmentRow { torn_user_id: number; member_name: string; role: ManagedFactionRole; status: ManagedAccessStatus; assigned_by_torn_id: number; updated_at: string }
interface LocalAuditRow { id: number; torn_user_id: number; member_name: string; action: FactionAccessAuditEvent["action"]; role: ManagedFactionRole; status: FactionAccessAuditEvent["status"]; actor_torn_user_id: number; created_at: string }
