import "server-only";

import { randomUUID } from "node:crypto";
import { cache } from "react";
import { localDatabaseExists, openLocalDatabase } from "@/lib/data/local-database";
import { ensureRotationsMaterialized } from "./chain-watch-rotation-store";

export const DEFAULT_ROLE_NAME = "Chain Watcher";
export const DEFAULT_BUFFER_SECONDS = 120;

export interface ChainWatchSlot {
  id: string;
  startAt: string;
  endAt: string;
  primaryTornUserId: number;
  primaryMemberName: string;
  backupTornUserId: number | null;
  backupMemberName: string | null;
  note: string | null;
  rotationId: string | null;
  rotationSequence: number | null;
  createdByTornId: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChainWatchWorkspace {
  databaseConfigured: boolean;
  databaseAvailable: boolean;
  roleName: string;
  bufferSeconds: number;
  slots: ChainWatchSlot[];
  message: string;
}

export interface ChainWatchSettingsInput {
  roleName: string;
  bufferSeconds: number;
}

export interface ChainWatchSlotInput {
  startAt: string;
  endAt: string;
  primaryTornUserId: number;
  primaryMemberName: string;
  backupTornUserId: number | null;
  backupMemberName: string | null;
  note: string | null;
}

export const getChainWatchWorkspace = cache(async (factionId: number | null): Promise<ChainWatchWorkspace> => {
  const hasPostgres = Boolean(process.env.DATABASE_URL?.trim());
  if (!hasPostgres && !localDatabaseExists()) return empty(false, false, "Create local storage in Settings before scheduling chain watch coverage.");
  if (!factionId) return empty(true, true, "Connect a verified faction to schedule chain watch coverage.");
  await ensureRotationsMaterialized(factionId);
  return hasPostgres ? getPostgresWorkspace(factionId) : getLocalWorkspace(factionId);
});

export async function setChainWatchSettings(factionId: number, input: ChainWatchSettingsInput): Promise<void> {
  if (process.env.DATABASE_URL?.trim()) return setPostgresSettings(factionId, input);
  return setLocalSettings(factionId, input);
}

export async function createChainWatchSlot(factionId: number, input: ChainWatchSlotInput, createdByTornId: number): Promise<ChainWatchSlot> {
  if (process.env.DATABASE_URL?.trim()) return createPostgresSlot(factionId, input, createdByTornId);
  return createLocalSlot(factionId, input, createdByTornId);
}

export async function updateChainWatchSlot(factionId: number, slotId: string, input: ChainWatchSlotInput): Promise<ChainWatchSlot> {
  if (process.env.DATABASE_URL?.trim()) return updatePostgresSlot(factionId, slotId, input);
  return updateLocalSlot(factionId, slotId, input);
}

export async function deleteChainWatchSlot(factionId: number, slotId: string): Promise<void> {
  if (process.env.DATABASE_URL?.trim()) return deletePostgresSlot(factionId, slotId);
  return deleteLocalSlot(factionId, slotId);
}

export async function createChainWatchSlotsBatch(factionId: number, inputs: ChainWatchSlotInput[], createdByTornId: number): Promise<ChainWatchSlot[]> {
  if (inputs.length === 0) return [];
  return process.env.DATABASE_URL?.trim() ? createPostgresSlotsBatch(factionId, inputs, createdByTornId) : createLocalSlotsBatch(factionId, inputs, createdByTornId);
}

/** Returns how many of the requested slots actually existed and were removed. */
export async function deleteChainWatchSlotsBatch(factionId: number, slotIds: string[]): Promise<number> {
  if (slotIds.length === 0) return 0;
  return process.env.DATABASE_URL?.trim() ? deletePostgresSlotsBatch(factionId, slotIds) : deleteLocalSlotsBatch(factionId, slotIds);
}

/** Swaps only the primary member between two slots, atomically. */
export async function swapChainWatchSlotPrimaries(factionId: number, slotIdA: string, slotIdB: string): Promise<{ slotA: ChainWatchSlot; slotB: ChainWatchSlot }> {
  return process.env.DATABASE_URL?.trim() ? swapPostgresSlotPrimaries(factionId, slotIdA, slotIdB) : swapLocalSlotPrimaries(factionId, slotIdA, slotIdB);
}

// Local (SQLite) -------------------------------------------------------------

function getLocalWorkspace(factionId: number): ChainWatchWorkspace {
  const database = openLocalDatabase();
  if (!database) return empty(false, false, "The local database file is unavailable.");
  try {
    const settings = database.prepare("SELECT role_name, buffer_seconds FROM chain_watch_settings WHERE faction_id = ?").get(factionId) as unknown as { role_name: string; buffer_seconds: number } | undefined;
    const slots = (database.prepare("SELECT * FROM chain_watch_slots WHERE faction_id = ? ORDER BY start_at ASC").all(factionId) as unknown as LocalSlotRow[]).map(mapLocalSlot);
    return {
      databaseConfigured: true,
      databaseAvailable: true,
      roleName: settings?.role_name ?? DEFAULT_ROLE_NAME,
      bufferSeconds: settings?.buffer_seconds ?? DEFAULT_BUFFER_SECONDS,
      slots,
      message: slots.length ? `${slots.length} scheduled coverage slot${slots.length === 1 ? "" : "s"}.` : "No coverage slots scheduled yet.",
    };
  } catch {
    return empty(true, false, "The local chain watch schedule could not be read safely.");
  } finally {
    database.close();
  }
}

function setLocalSettings(factionId: number, input: ChainWatchSettingsInput): void {
  const database = openLocalDatabase();
  if (!database) throw new Error("Create local storage before saving chain watch settings.");
  try {
    database.prepare(`
      INSERT INTO chain_watch_settings (faction_id, role_name, buffer_seconds, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(faction_id) DO UPDATE SET role_name = excluded.role_name, buffer_seconds = excluded.buffer_seconds, updated_at = excluded.updated_at
    `).run(factionId, input.roleName, input.bufferSeconds, new Date().toISOString());
  } finally {
    database.close();
  }
}

function createLocalSlot(factionId: number, input: ChainWatchSlotInput, createdByTornId: number): ChainWatchSlot {
  const database = openLocalDatabase();
  if (!database) throw new Error("Create local storage before scheduling chain watch coverage.");
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    database.prepare(`
      INSERT INTO chain_watch_slots (id, faction_id, start_at, end_at, primary_torn_user_id, primary_member_name, backup_torn_user_id, backup_member_name, note, created_by_torn_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, factionId, input.startAt, input.endAt, input.primaryTornUserId, input.primaryMemberName, input.backupTornUserId, input.backupMemberName, input.note, createdByTornId, now, now);
    return { id, startAt: input.startAt, endAt: input.endAt, primaryTornUserId: input.primaryTornUserId, primaryMemberName: input.primaryMemberName, backupTornUserId: input.backupTornUserId, backupMemberName: input.backupMemberName, note: input.note, rotationId: null, rotationSequence: null, createdByTornId, createdAt: now, updatedAt: now };
  } finally {
    database.close();
  }
}

function updateLocalSlot(factionId: number, slotId: string, input: ChainWatchSlotInput): ChainWatchSlot {
  const database = openLocalDatabase();
  if (!database) throw new Error("The local chain watch schedule is unavailable.");
  const now = new Date().toISOString();
  try {
    const existing = database.prepare("SELECT created_by_torn_id, created_at, rotation_id, rotation_sequence FROM chain_watch_slots WHERE id = ? AND faction_id = ?").get(slotId, factionId) as unknown as { created_by_torn_id: number; created_at: string; rotation_id: string | null; rotation_sequence: number | null } | undefined;
    if (!existing) throw new Error("This coverage slot no longer exists.");
    database.prepare(`
      UPDATE chain_watch_slots
      SET start_at = ?, end_at = ?, primary_torn_user_id = ?, primary_member_name = ?, backup_torn_user_id = ?, backup_member_name = ?, note = ?, updated_at = ?
      WHERE id = ? AND faction_id = ?
    `).run(input.startAt, input.endAt, input.primaryTornUserId, input.primaryMemberName, input.backupTornUserId, input.backupMemberName, input.note, now, slotId, factionId);
    return {
      id: slotId, startAt: input.startAt, endAt: input.endAt, primaryTornUserId: input.primaryTornUserId, primaryMemberName: input.primaryMemberName,
      backupTornUserId: input.backupTornUserId, backupMemberName: input.backupMemberName, note: input.note,
      rotationId: existing.rotation_id, rotationSequence: existing.rotation_sequence,
      createdByTornId: existing.created_by_torn_id, createdAt: existing.created_at, updatedAt: now,
    };
  } finally {
    database.close();
  }
}

function deleteLocalSlot(factionId: number, slotId: string): void {
  const database = openLocalDatabase();
  if (!database) throw new Error("The local chain watch schedule is unavailable.");
  try {
    const result = database.prepare("DELETE FROM chain_watch_slots WHERE id = ? AND faction_id = ?").run(slotId, factionId);
    if (result.changes === 0) throw new Error("This coverage slot no longer exists.");
  } finally {
    database.close();
  }
}

function createLocalSlotsBatch(factionId: number, inputs: ChainWatchSlotInput[], createdByTornId: number): ChainWatchSlot[] {
  const database = openLocalDatabase();
  if (!database) throw new Error("Create local storage before scheduling chain watch coverage.");
  const now = new Date().toISOString();
  try {
    database.exec("BEGIN IMMEDIATE");
    const insert = database.prepare(`
      INSERT INTO chain_watch_slots (id, faction_id, start_at, end_at, primary_torn_user_id, primary_member_name, backup_torn_user_id, backup_member_name, note, created_by_torn_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const created = inputs.map((input) => {
      const id = randomUUID();
      insert.run(id, factionId, input.startAt, input.endAt, input.primaryTornUserId, input.primaryMemberName, input.backupTornUserId, input.backupMemberName, input.note, createdByTornId, now, now);
      return { id, ...input, rotationId: null, rotationSequence: null, createdByTornId, createdAt: now, updatedAt: now };
    });
    database.exec("COMMIT");
    return created;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction did not begin. */ }
    throw error;
  } finally {
    database.close();
  }
}

function deleteLocalSlotsBatch(factionId: number, slotIds: string[]): number {
  const database = openLocalDatabase();
  if (!database) throw new Error("The local chain watch schedule is unavailable.");
  try {
    database.exec("BEGIN IMMEDIATE");
    const remove = database.prepare("DELETE FROM chain_watch_slots WHERE id = ? AND faction_id = ?");
    let removed = 0;
    for (const slotId of slotIds) removed += Number(remove.run(slotId, factionId).changes);
    database.exec("COMMIT");
    return removed;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction did not begin. */ }
    throw error;
  } finally {
    database.close();
  }
}

function swapLocalSlotPrimaries(factionId: number, slotIdA: string, slotIdB: string): { slotA: ChainWatchSlot; slotB: ChainWatchSlot } {
  const database = openLocalDatabase();
  if (!database) throw new Error("The local chain watch schedule is unavailable.");
  const now = new Date().toISOString();
  try {
    database.exec("BEGIN IMMEDIATE");
    const rowA = database.prepare("SELECT * FROM chain_watch_slots WHERE id = ? AND faction_id = ?").get(slotIdA, factionId) as unknown as LocalSlotRow | undefined;
    const rowB = database.prepare("SELECT * FROM chain_watch_slots WHERE id = ? AND faction_id = ?").get(slotIdB, factionId) as unknown as LocalSlotRow | undefined;
    if (!rowA || !rowB) throw new Error("Both slots must still exist to swap them.");
    const update = database.prepare("UPDATE chain_watch_slots SET primary_torn_user_id = ?, primary_member_name = ?, updated_at = ? WHERE id = ?");
    update.run(rowB.primary_torn_user_id, rowB.primary_member_name, now, slotIdA);
    update.run(rowA.primary_torn_user_id, rowA.primary_member_name, now, slotIdB);
    database.exec("COMMIT");
    return {
      slotA: mapLocalSlot({ ...rowA, primary_torn_user_id: rowB.primary_torn_user_id, primary_member_name: rowB.primary_member_name, updated_at: now }),
      slotB: mapLocalSlot({ ...rowB, primary_torn_user_id: rowA.primary_torn_user_id, primary_member_name: rowA.primary_member_name, updated_at: now }),
    };
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction did not begin. */ }
    throw error;
  } finally {
    database.close();
  }
}

// Postgres ---------------------------------------------------------------

async function getPostgresWorkspace(factionId: number): Promise<ChainWatchWorkspace> {
  try {
    const { db } = await import("@/lib/db");
    const faction = await db.faction.findUnique({ where: { tornFactionId: factionId }, include: { chainWatchSettings: true, chainWatchSlots: { orderBy: { startAt: "asc" } } } });
    if (!faction) return empty(true, true, "No coverage slots scheduled yet.");
    const slots = faction.chainWatchSlots.map(mapPostgresSlot);
    return {
      databaseConfigured: true,
      databaseAvailable: true,
      roleName: faction.chainWatchSettings?.roleName ?? DEFAULT_ROLE_NAME,
      bufferSeconds: faction.chainWatchSettings?.bufferSeconds ?? DEFAULT_BUFFER_SECONDS,
      slots,
      message: slots.length ? `${slots.length} scheduled coverage slot${slots.length === 1 ? "" : "s"}.` : "No coverage slots scheduled yet.",
    };
  } catch {
    return empty(true, false, "The configured chain watch schedule could not be queried.");
  }
}

async function setPostgresSettings(factionId: number, input: ChainWatchSettingsInput): Promise<void> {
  const { db } = await import("@/lib/db");
  const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
  if (!faction) throw new Error("The connected faction could not be found.");
  await db.chainWatchSettings.upsert({
    where: { factionId: faction.id },
    update: { roleName: input.roleName, bufferSeconds: input.bufferSeconds },
    create: { factionId: faction.id, roleName: input.roleName, bufferSeconds: input.bufferSeconds },
  });
}

async function createPostgresSlot(factionId: number, input: ChainWatchSlotInput, createdByTornId: number): Promise<ChainWatchSlot> {
  const { db } = await import("@/lib/db");
  const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
  if (!faction) throw new Error("The connected faction could not be found.");
  const slot = await db.chainWatchSlot.create({
    data: {
      factionId: faction.id,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      primaryTornUserId: input.primaryTornUserId,
      primaryMemberName: input.primaryMemberName,
      backupTornUserId: input.backupTornUserId,
      backupMemberName: input.backupMemberName,
      note: input.note,
      createdByTornId,
    },
  });
  return mapPostgresSlot(slot);
}

async function updatePostgresSlot(factionId: number, slotId: string, input: ChainWatchSlotInput): Promise<ChainWatchSlot> {
  const { db } = await import("@/lib/db");
  const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
  if (!faction) throw new Error("The connected faction could not be found.");
  const existing = await db.chainWatchSlot.findUnique({ where: { id: slotId } });
  if (!existing || existing.factionId !== faction.id) throw new Error("This coverage slot no longer exists.");
  const slot = await db.chainWatchSlot.update({
    where: { id: slotId },
    data: {
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      primaryTornUserId: input.primaryTornUserId,
      primaryMemberName: input.primaryMemberName,
      backupTornUserId: input.backupTornUserId,
      backupMemberName: input.backupMemberName,
      note: input.note,
    },
  });
  return mapPostgresSlot(slot);
}

async function deletePostgresSlot(factionId: number, slotId: string): Promise<void> {
  const { db } = await import("@/lib/db");
  const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
  if (!faction) throw new Error("The connected faction could not be found.");
  const existing = await db.chainWatchSlot.findUnique({ where: { id: slotId } });
  if (!existing || existing.factionId !== faction.id) throw new Error("This coverage slot no longer exists.");
  await db.chainWatchSlot.delete({ where: { id: slotId } });
}

async function createPostgresSlotsBatch(factionId: number, inputs: ChainWatchSlotInput[], createdByTornId: number): Promise<ChainWatchSlot[]> {
  const { db } = await import("@/lib/db");
  const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
  if (!faction) throw new Error("The connected faction could not be found.");
  return db.$transaction(async (transaction) => {
    const created: ChainWatchSlot[] = [];
    for (const input of inputs) {
      const slot = await transaction.chainWatchSlot.create({
        data: {
          factionId: faction.id,
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          primaryTornUserId: input.primaryTornUserId,
          primaryMemberName: input.primaryMemberName,
          backupTornUserId: input.backupTornUserId,
          backupMemberName: input.backupMemberName,
          note: input.note,
          createdByTornId,
        },
      });
      created.push(mapPostgresSlot(slot));
    }
    return created;
  });
}

async function deletePostgresSlotsBatch(factionId: number, slotIds: string[]): Promise<number> {
  const { db } = await import("@/lib/db");
  const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
  if (!faction) throw new Error("The connected faction could not be found.");
  const result = await db.chainWatchSlot.deleteMany({ where: { id: { in: slotIds }, factionId: faction.id } });
  return result.count;
}

async function swapPostgresSlotPrimaries(factionId: number, slotIdA: string, slotIdB: string): Promise<{ slotA: ChainWatchSlot; slotB: ChainWatchSlot }> {
  const { db } = await import("@/lib/db");
  const faction = await db.faction.findUnique({ where: { tornFactionId: factionId } });
  if (!faction) throw new Error("The connected faction could not be found.");
  return db.$transaction(async (transaction) => {
    const rowA = await transaction.chainWatchSlot.findUnique({ where: { id: slotIdA } });
    const rowB = await transaction.chainWatchSlot.findUnique({ where: { id: slotIdB } });
    if (!rowA || !rowB || rowA.factionId !== faction.id || rowB.factionId !== faction.id) throw new Error("Both slots must still exist to swap them.");
    const slotA = await transaction.chainWatchSlot.update({ where: { id: slotIdA }, data: { primaryTornUserId: rowB.primaryTornUserId, primaryMemberName: rowB.primaryMemberName } });
    const slotB = await transaction.chainWatchSlot.update({ where: { id: slotIdB }, data: { primaryTornUserId: rowA.primaryTornUserId, primaryMemberName: rowA.primaryMemberName } });
    return { slotA: mapPostgresSlot(slotA), slotB: mapPostgresSlot(slotB) };
  });
}

function mapPostgresSlot(slot: { id: string; startAt: Date; endAt: Date; primaryTornUserId: number; primaryMemberName: string; backupTornUserId: number | null; backupMemberName: string | null; note: string | null; rotationId: string | null; rotationSequence: number | null; createdByTornId: number; createdAt: Date; updatedAt: Date }): ChainWatchSlot {
  return {
    id: slot.id,
    startAt: slot.startAt.toISOString(),
    endAt: slot.endAt.toISOString(),
    primaryTornUserId: slot.primaryTornUserId,
    primaryMemberName: slot.primaryMemberName,
    backupTornUserId: slot.backupTornUserId,
    backupMemberName: slot.backupMemberName,
    note: slot.note,
    rotationId: slot.rotationId,
    rotationSequence: slot.rotationSequence,
    createdByTornId: slot.createdByTornId,
    createdAt: slot.createdAt.toISOString(),
    updatedAt: slot.updatedAt.toISOString(),
  };
}

function mapLocalSlot(row: LocalSlotRow): ChainWatchSlot {
  return {
    id: row.id,
    startAt: row.start_at,
    endAt: row.end_at,
    primaryTornUserId: row.primary_torn_user_id,
    primaryMemberName: row.primary_member_name,
    backupTornUserId: row.backup_torn_user_id,
    backupMemberName: row.backup_member_name,
    note: row.note,
    rotationId: row.rotation_id,
    rotationSequence: row.rotation_sequence,
    createdByTornId: row.created_by_torn_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function empty(databaseConfigured: boolean, databaseAvailable: boolean, message: string): ChainWatchWorkspace {
  return { databaseConfigured, databaseAvailable, roleName: DEFAULT_ROLE_NAME, bufferSeconds: DEFAULT_BUFFER_SECONDS, slots: [], message };
}

interface LocalSlotRow {
  id: string;
  faction_id: number;
  start_at: string;
  end_at: string;
  primary_torn_user_id: number;
  primary_member_name: string;
  backup_torn_user_id: number | null;
  backup_member_name: string | null;
  note: string | null;
  rotation_id: string | null;
  rotation_sequence: number | null;
  created_by_torn_id: number;
  created_at: string;
  updated_at: string;
}
