import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { openLocalDatabase } from "@/lib/data/local-database";
import {
  needsMaterialization,
  planRotationInstances,
  type ChainWatchRotationMember,
  type RotationPlan,
} from "./chain-watch-rotation";

export interface ChainWatchRotation {
  id: string;
  label: string;
  weekdaysMask: number;
  startMinuteUtc: number;
  endMinuteUtc: number;
  members: ChainWatchRotationMember[];
  backupTornUserId: number | null;
  backupMemberName: string | null;
  note: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
  isPaused: boolean;
  cursorDate: string | null;
  cursorIndex: number | null;
  createdByTornId: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChainWatchRotationInput {
  label: string;
  weekdaysMask: number;
  startMinuteUtc: number;
  endMinuteUtc: number;
  members: ChainWatchRotationMember[];
  backupTornUserId: number | null;
  backupMemberName: string | null;
  note: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

const DEFAULT_HORIZON_DAYS = 28;
const DEFAULT_REFILL_THRESHOLD_DAYS = 7;

function usingPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function listChainWatchRotations(factionId: number): Promise<ChainWatchRotation[]> {
  return usingPostgres() ? listPostgresRotations(factionId) : listLocalRotations(factionId);
}

export async function createChainWatchRotation(factionId: number, input: ChainWatchRotationInput, createdByTornId: number): Promise<ChainWatchRotation> {
  return usingPostgres() ? createPostgresRotation(factionId, input, createdByTornId) : createLocalRotation(factionId, input, createdByTornId);
}

export async function updateChainWatchRotation(
  factionId: number,
  rotationId: string,
  input: ChainWatchRotationInput,
): Promise<{ rotation: ChainWatchRotation; manuallyAdjustedCount: number }> {
  return usingPostgres() ? updatePostgresRotation(factionId, rotationId, input) : updateLocalRotation(factionId, rotationId, input);
}

/** Removes the rotation. Its future (not-yet-started) generated slots are deleted; already-started ones are kept as history with `rotationId` cleared. */
export async function deleteChainWatchRotation(factionId: number, rotationId: string): Promise<void> {
  return usingPostgres() ? deletePostgresRotation(factionId, rotationId) : deleteLocalRotation(factionId, rotationId);
}

export async function pauseChainWatchRotation(factionId: number, rotationId: string, isPaused: boolean): Promise<void> {
  return usingPostgres() ? pausePostgresRotation(factionId, rotationId, isPaused) : pauseLocalRotation(factionId, rotationId, isPaused);
}

/**
 * Tops up every active rotation whose materialized horizon is running low.
 * Best-effort by design: there is no scheduled job in this deployment, so
 * this runs lazily whenever the schedule is read, and a hiccup on one
 * rotation (or on the whole pass) must never turn "load the page" into a
 * hard failure.
 */
export async function ensureRotationsMaterialized(
  factionId: number,
  horizonDays = DEFAULT_HORIZON_DAYS,
  refillThresholdDays = DEFAULT_REFILL_THRESHOLD_DAYS,
): Promise<void> {
  let rotations: ChainWatchRotation[];
  try {
    rotations = await listChainWatchRotations(factionId);
  } catch {
    return;
  }
  const now = Date.now();
  const horizonEndMs = now + horizonDays * 24 * 60 * 60 * 1_000;
  for (const rotation of rotations) {
    if (rotation.isPaused) continue;
    if (!needsMaterialization(rotation.cursorDate, now, refillThresholdDays)) continue;
    try {
      const plan = planRotationInstances(rotation, horizonEndMs);
      if (plan.instances.length > 0) await materializeRotation(factionId, rotation, plan);
    } catch {
      // A single rotation's materialization failure must not block the others.
    }
  }
}

async function materializeRotation(factionId: number, rotation: ChainWatchRotation, plan: RotationPlan): Promise<void> {
  return usingPostgres() ? materializePostgresRotation(factionId, rotation, plan) : materializeLocalRotation(factionId, rotation, plan);
}

function parseMembers(value: unknown): ChainWatchRotationMember[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    return typeof candidate.tornUserId === "number" && typeof candidate.memberName === "string"
      ? [{ tornUserId: candidate.tornUserId, memberName: candidate.memberName }]
      : [];
  });
}

// Local (SQLite) -------------------------------------------------------------

interface LocalRotationRow {
  id: string;
  faction_id: number;
  label: string;
  weekdays_mask: number;
  start_minute_utc: number;
  end_minute_utc: number;
  members_json: string;
  backup_torn_user_id: number | null;
  backup_member_name: string | null;
  note: string | null;
  effective_from: string;
  effective_until: string | null;
  is_paused: number;
  cursor_date: string | null;
  cursor_index: number | null;
  created_by_torn_id: number;
  created_at: string;
  updated_at: string;
}

function listLocalRotations(factionId: number): ChainWatchRotation[] {
  const database = openLocalDatabase();
  if (!database) return [];
  try {
    return (database.prepare("SELECT * FROM chain_watch_rotations WHERE faction_id = ? ORDER BY label ASC").all(factionId) as unknown as LocalRotationRow[]).map(mapLocalRotation);
  } finally {
    database.close();
  }
}

function createLocalRotation(factionId: number, input: ChainWatchRotationInput, createdByTornId: number): ChainWatchRotation {
  const database = openLocalDatabase();
  if (!database) throw new Error("Create local storage before scheduling a rotation.");
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    database.prepare(`
      INSERT INTO chain_watch_rotations (
        id, faction_id, label, weekdays_mask, start_minute_utc, end_minute_utc, members_json,
        backup_torn_user_id, backup_member_name, note, effective_from, effective_until,
        is_paused, cursor_date, cursor_index, created_by_torn_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?)
    `).run(
      id, factionId, input.label, input.weekdaysMask, input.startMinuteUtc, input.endMinuteUtc, JSON.stringify(input.members),
      input.backupTornUserId, input.backupMemberName, input.note, input.effectiveFrom, input.effectiveUntil,
      createdByTornId, now, now,
    );
    return { id, ...input, isPaused: false, cursorDate: null, cursorIndex: null, createdByTornId, createdAt: now, updatedAt: now };
  } finally {
    database.close();
  }
}

function updateLocalRotation(factionId: number, rotationId: string, input: ChainWatchRotationInput): { rotation: ChainWatchRotation; manuallyAdjustedCount: number } {
  const database = openLocalDatabase();
  if (!database) throw new Error("The local chain watch schedule is unavailable.");
  const now = new Date().toISOString();
  try {
    database.exec("BEGIN IMMEDIATE");
    const existing = database.prepare("SELECT * FROM chain_watch_rotations WHERE id = ? AND faction_id = ?").get(rotationId, factionId) as unknown as LocalRotationRow | undefined;
    if (!existing) throw new Error("This rotation no longer exists.");

    const lastStarted = database.prepare(
      "SELECT start_at, rotation_sequence FROM chain_watch_slots WHERE rotation_id = ? AND start_at <= ? ORDER BY start_at DESC LIMIT 1",
    ).get(rotationId, now) as unknown as { start_at: string; rotation_sequence: number | null } | undefined;
    const manuallyAdjusted = database.prepare(
      "SELECT COUNT(*) AS total FROM chain_watch_slots WHERE rotation_id = ? AND start_at > ? AND updated_at != created_at",
    ).get(rotationId, now) as unknown as { total: number };
    database.prepare("DELETE FROM chain_watch_slots WHERE rotation_id = ? AND start_at > ?").run(rotationId, now);

    const cursorDate = lastStarted ? new Date(Date.parse(lastStarted.start_at) - existing.start_minute_utc * 60_000).toISOString() : null;
    const cursorIndex = lastStarted ? lastStarted.rotation_sequence : null;

    database.prepare(`
      UPDATE chain_watch_rotations
      SET label = ?, weekdays_mask = ?, start_minute_utc = ?, end_minute_utc = ?, members_json = ?,
          backup_torn_user_id = ?, backup_member_name = ?, note = ?, effective_from = ?, effective_until = ?,
          cursor_date = ?, cursor_index = ?, updated_at = ?
      WHERE id = ? AND faction_id = ?
    `).run(
      input.label, input.weekdaysMask, input.startMinuteUtc, input.endMinuteUtc, JSON.stringify(input.members),
      input.backupTornUserId, input.backupMemberName, input.note, input.effectiveFrom, input.effectiveUntil,
      cursorDate, cursorIndex, now, rotationId, factionId,
    );
    database.exec("COMMIT");
    return {
      rotation: {
        id: rotationId, ...input, isPaused: Boolean(existing.is_paused), cursorDate, cursorIndex,
        createdByTornId: existing.created_by_torn_id, createdAt: existing.created_at, updatedAt: now,
      },
      manuallyAdjustedCount: manuallyAdjusted.total,
    };
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction did not begin. */ }
    throw error;
  } finally {
    database.close();
  }
}

function deleteLocalRotation(factionId: number, rotationId: string): void {
  const database = openLocalDatabase();
  if (!database) throw new Error("The local chain watch schedule is unavailable.");
  const now = new Date().toISOString();
  try {
    database.exec("BEGIN IMMEDIATE");
    const existing = database.prepare("SELECT id FROM chain_watch_rotations WHERE id = ? AND faction_id = ?").get(rotationId, factionId);
    if (!existing) throw new Error("This rotation no longer exists.");
    database.prepare("UPDATE chain_watch_slots SET rotation_id = NULL, rotation_sequence = NULL, updated_at = ? WHERE rotation_id = ? AND start_at <= ?").run(now, rotationId, now);
    database.prepare("DELETE FROM chain_watch_slots WHERE rotation_id = ? AND start_at > ?").run(rotationId, now);
    database.prepare("DELETE FROM chain_watch_rotations WHERE id = ?").run(rotationId);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction did not begin. */ }
    throw error;
  } finally {
    database.close();
  }
}

function pauseLocalRotation(factionId: number, rotationId: string, isPaused: boolean): void {
  const database = openLocalDatabase();
  if (!database) throw new Error("The local chain watch schedule is unavailable.");
  try {
    const result = database.prepare("UPDATE chain_watch_rotations SET is_paused = ?, updated_at = ? WHERE id = ? AND faction_id = ?")
      .run(isPaused ? 1 : 0, new Date().toISOString(), rotationId, factionId);
    if (result.changes === 0) throw new Error("This rotation no longer exists.");
  } finally {
    database.close();
  }
}

function materializeLocalRotation(factionId: number, rotation: ChainWatchRotation, plan: RotationPlan): void {
  const database = openLocalDatabase();
  if (!database) return;
  const now = new Date().toISOString();
  try {
    database.exec("BEGIN IMMEDIATE");
    const insertSlot = database.prepare(`
      INSERT OR IGNORE INTO chain_watch_slots (
        id, faction_id, start_at, end_at, primary_torn_user_id, primary_member_name,
        backup_torn_user_id, backup_member_name, note, rotation_id, rotation_sequence,
        created_by_torn_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const instance of plan.instances) {
      const member = rotation.members[instance.memberIndex];
      if (!member) continue;
      insertSlot.run(
        randomUUID(), factionId, instance.startAt, instance.endAt, member.tornUserId, member.memberName,
        rotation.backupTornUserId, rotation.backupMemberName, rotation.note, rotation.id, instance.memberIndex,
        rotation.createdByTornId, now, now,
      );
    }
    database.prepare("UPDATE chain_watch_rotations SET cursor_date = ?, cursor_index = ?, updated_at = ? WHERE id = ?")
      .run(plan.nextCursorDate, plan.nextCursorIndex, now, rotation.id);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction did not begin. */ }
    throw error;
  } finally {
    database.close();
  }
}

function mapLocalRotation(row: LocalRotationRow): ChainWatchRotation {
  return {
    id: row.id,
    label: row.label,
    weekdaysMask: row.weekdays_mask,
    startMinuteUtc: row.start_minute_utc,
    endMinuteUtc: row.end_minute_utc,
    members: parseMembers(JSON.parse(row.members_json)),
    backupTornUserId: row.backup_torn_user_id,
    backupMemberName: row.backup_member_name,
    note: row.note,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    isPaused: Boolean(row.is_paused),
    cursorDate: row.cursor_date,
    cursorIndex: row.cursor_index,
    createdByTornId: row.created_by_torn_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Postgres ---------------------------------------------------------------

async function listPostgresRotations(factionId: number): Promise<ChainWatchRotation[]> {
  const { db } = await import("@/lib/db");
  const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
  if (!faction) return [];
  const rotations = await db.chainWatchRotation.findMany({ where: { factionId: faction.id }, orderBy: { label: "asc" } });
  return rotations.map(mapPostgresRotation);
}

async function createPostgresRotation(factionId: number, input: ChainWatchRotationInput, createdByTornId: number): Promise<ChainWatchRotation> {
  const { db } = await import("@/lib/db");
  const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
  if (!faction) throw new Error("The connected faction could not be found.");
  const rotation = await db.chainWatchRotation.create({
    data: {
      factionId: faction.id,
      label: input.label,
      weekdaysMask: input.weekdaysMask,
      startMinuteUtc: input.startMinuteUtc,
      endMinuteUtc: input.endMinuteUtc,
      members: JSON.parse(JSON.stringify(input.members)) as Prisma.InputJsonValue,
      backupTornUserId: input.backupTornUserId,
      backupMemberName: input.backupMemberName,
      note: input.note,
      effectiveFrom: new Date(input.effectiveFrom),
      effectiveUntil: input.effectiveUntil ? new Date(input.effectiveUntil) : null,
      createdByTornId,
    },
  });
  return mapPostgresRotation(rotation);
}

async function updatePostgresRotation(
  factionId: number,
  rotationId: string,
  input: ChainWatchRotationInput,
): Promise<{ rotation: ChainWatchRotation; manuallyAdjustedCount: number }> {
  const { db } = await import("@/lib/db");
  return db.$transaction(async (transaction) => {
    const faction = await transaction.faction.findUnique({ where: { tornFactionId: factionId } });
    if (!faction) throw new Error("The connected faction could not be found.");
    const existing = await transaction.chainWatchRotation.findUnique({ where: { id: rotationId } });
    if (!existing || existing.factionId !== faction.id) throw new Error("This rotation no longer exists.");

    const now = new Date();
    const lastStarted = await transaction.chainWatchSlot.findFirst({
      where: { rotationId, startAt: { lte: now } },
      orderBy: { startAt: "desc" },
      select: { startAt: true, rotationSequence: true },
    });
    const futureSlots = await transaction.chainWatchSlot.findMany({
      where: { rotationId, startAt: { gt: now } },
      select: { createdAt: true, updatedAt: true },
    });
    const manuallyAdjustedCount = futureSlots.filter((slot) => slot.updatedAt.getTime() !== slot.createdAt.getTime()).length;
    await transaction.chainWatchSlot.deleteMany({ where: { rotationId, startAt: { gt: now } } });

    const cursorDate = lastStarted ? new Date(lastStarted.startAt.getTime() - existing.startMinuteUtc * 60_000) : null;
    const cursorIndex = lastStarted ? lastStarted.rotationSequence : null;

    const rotation = await transaction.chainWatchRotation.update({
      where: { id: rotationId },
      data: {
        label: input.label,
        weekdaysMask: input.weekdaysMask,
        startMinuteUtc: input.startMinuteUtc,
        endMinuteUtc: input.endMinuteUtc,
        members: JSON.parse(JSON.stringify(input.members)) as Prisma.InputJsonValue,
        backupTornUserId: input.backupTornUserId,
        backupMemberName: input.backupMemberName,
        note: input.note,
        effectiveFrom: new Date(input.effectiveFrom),
        effectiveUntil: input.effectiveUntil ? new Date(input.effectiveUntil) : null,
        cursorDate,
        cursorIndex,
      },
    });
    return { rotation: mapPostgresRotation(rotation), manuallyAdjustedCount };
  });
}

async function deletePostgresRotation(factionId: number, rotationId: string): Promise<void> {
  const { db } = await import("@/lib/db");
  await db.$transaction(async (transaction) => {
    const faction = await transaction.faction.findUnique({ where: { tornFactionId: factionId } });
    if (!faction) throw new Error("The connected faction could not be found.");
    const existing = await transaction.chainWatchRotation.findUnique({ where: { id: rotationId } });
    if (!existing || existing.factionId !== faction.id) throw new Error("This rotation no longer exists.");
    const now = new Date();
    await transaction.chainWatchSlot.updateMany({ where: { rotationId, startAt: { lte: now } }, data: { rotationId: null, rotationSequence: null } });
    await transaction.chainWatchSlot.deleteMany({ where: { rotationId, startAt: { gt: now } } });
    await transaction.chainWatchRotation.delete({ where: { id: rotationId } });
  });
}

async function pausePostgresRotation(factionId: number, rotationId: string, isPaused: boolean): Promise<void> {
  const { db } = await import("@/lib/db");
  const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
  if (!faction) throw new Error("The connected faction could not be found.");
  const existing = await db.chainWatchRotation.findUnique({ where: { id: rotationId } });
  if (!existing || existing.factionId !== faction.id) throw new Error("This rotation no longer exists.");
  await db.chainWatchRotation.update({ where: { id: rotationId }, data: { isPaused } });
}

async function materializePostgresRotation(factionId: number, rotation: ChainWatchRotation, plan: RotationPlan): Promise<void> {
  const { db } = await import("@/lib/db");
  const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
  if (!faction) return;
  await db.$transaction(async (transaction) => {
    const data = plan.instances.flatMap((instance) => {
      const member = rotation.members[instance.memberIndex];
      if (!member) return [];
      return [{
        factionId: faction.id,
        startAt: new Date(instance.startAt),
        endAt: new Date(instance.endAt),
        primaryTornUserId: member.tornUserId,
        primaryMemberName: member.memberName,
        backupTornUserId: rotation.backupTornUserId,
        backupMemberName: rotation.backupMemberName,
        note: rotation.note,
        rotationId: rotation.id,
        rotationSequence: instance.memberIndex,
        createdByTornId: rotation.createdByTornId,
      }];
    });
    if (data.length > 0) await transaction.chainWatchSlot.createMany({ data, skipDuplicates: true });
    await transaction.chainWatchRotation.update({
      where: { id: rotation.id },
      data: { cursorDate: plan.nextCursorDate ? new Date(plan.nextCursorDate) : null, cursorIndex: plan.nextCursorIndex },
    });
  });
}

function mapPostgresRotation(rotation: {
  id: string;
  label: string;
  weekdaysMask: number;
  startMinuteUtc: number;
  endMinuteUtc: number;
  members: unknown;
  backupTornUserId: number | null;
  backupMemberName: string | null;
  note: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  isPaused: boolean;
  cursorDate: Date | null;
  cursorIndex: number | null;
  createdByTornId: number;
  createdAt: Date;
  updatedAt: Date;
}): ChainWatchRotation {
  return {
    id: rotation.id,
    label: rotation.label,
    weekdaysMask: rotation.weekdaysMask,
    startMinuteUtc: rotation.startMinuteUtc,
    endMinuteUtc: rotation.endMinuteUtc,
    members: parseMembers(rotation.members),
    backupTornUserId: rotation.backupTornUserId,
    backupMemberName: rotation.backupMemberName,
    note: rotation.note,
    effectiveFrom: rotation.effectiveFrom.toISOString(),
    effectiveUntil: rotation.effectiveUntil?.toISOString() ?? null,
    isPaused: rotation.isPaused,
    cursorDate: rotation.cursorDate?.toISOString() ?? null,
    cursorIndex: rotation.cursorIndex,
    createdByTornId: rotation.createdByTornId,
    createdAt: rotation.createdAt.toISOString(),
    updatedAt: rotation.updatedAt.toISOString(),
  };
}
