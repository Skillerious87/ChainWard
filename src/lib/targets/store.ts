import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { localDatabaseExists, openLocalDatabase } from "@/lib/data/local-database";
import { withDbRetry } from "@/lib/data/with-db-retry";
import {
  MAX_TARGETS,
  targetListSchema,
  type TargetEntry,
  type TargetList,
  type TargetSnapshot,
} from "./types";

interface Faction { id: number; name: string; tag: string }

// A personal, per-operator list carrying the operator's own curation choices, so
// — like the retired `oc.private.` keys — it uses a prefix OUTSIDE the
// `appearance|rewards|payouts|members` set that the workspace backup exports.
const prefix = "targets.private.";

const emptyList: TargetList = { entries: [], snapshots: {} };

function storageError(): Error {
  return new Error("Create workspace storage in Settings before building a target list.");
}

export function targetsStorageAvailable(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim()) || localDatabaseExists();
}

export async function readTargetList(factionId: number, operatorId: number): Promise<TargetList> {
  const key = `${prefix}${operatorId}`;
  let raw: unknown;
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    const row = await withDbRetry(() => db.factionSetting.findFirst({ where: { faction: { tornFactionId: factionId }, key }, select: { value: true } }));
    raw = row?.value;
  } else {
    const database = openLocalDatabase();
    if (!database) return { ...emptyList };
    try {
      const row = database.prepare("SELECT value_json FROM faction_settings WHERE faction_id = ? AND key = ?").get(factionId, key) as { value_json: string } | undefined;
      raw = row ? (JSON.parse(row.value_json) as unknown) : undefined;
    } catch { return { ...emptyList }; }
    finally { database.close(); }
  }
  if (raw === undefined || raw === null) return { ...emptyList };
  const parsed = targetListSchema.safeParse(raw);
  if (!parsed.success) return { ...emptyList };
  // Drop orphan snapshots whose entry has been removed.
  const ids = new Set(parsed.data.entries.map((entry) => String(entry.tornUserId)));
  const snapshots: Record<string, TargetSnapshot> = {};
  for (const [id, snapshot] of Object.entries(parsed.data.snapshots)) {
    if (ids.has(id)) snapshots[id] = snapshot;
  }
  return { entries: parsed.data.entries.slice(0, MAX_TARGETS), snapshots };
}

export async function writeTargetList(faction: Faction, operatorId: number, list: TargetList): Promise<void> {
  const record = targetListSchema.parse(list);
  const key = `${prefix}${operatorId}`;
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await withDbRetry(() => db.$transaction(async (tx) => {
      const tenant = await tx.faction.upsert({ where: { tornFactionId: faction.id }, update: {}, create: { tornFactionId: faction.id, name: faction.name, tag: faction.tag } });
      await tx.factionSetting.upsert({
        where: { factionId_key: { factionId: tenant.id, key } },
        create: { factionId: tenant.id, key, value: record as unknown as Prisma.InputJsonValue },
        update: { value: record as unknown as Prisma.InputJsonValue },
      });
    }));
  } else {
    const database = openLocalDatabase();
    if (!database) throw storageError();
    try {
      database.prepare("INSERT INTO faction_settings (faction_id, key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(faction_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
        .run(faction.id, key, JSON.stringify(record), new Date().toISOString());
    } finally { database.close(); }
  }
}

/** Validates an add before any Torn call is spent on it. Returns `null` when
 *  the player can be added, or the user-facing reason when they can't. */
export function targetAddError(list: TargetList, tornUserId: number): string | null {
  if (list.entries.some((existing) => existing.tornUserId === tornUserId)) {
    return "That player is already on your target list.";
  }
  if (list.entries.length >= MAX_TARGETS) {
    return `A target list holds at most ${MAX_TARGETS} players. Remove one before adding another.`;
  }
  return null;
}

export function addTargetEntry(list: TargetList, entry: TargetEntry): TargetList {
  const error = targetAddError(list, entry.tornUserId);
  if (error) throw new Error(error);
  return { entries: [...list.entries, entry], snapshots: { ...list.snapshots } };
}

export function removeTargetEntry(list: TargetList, tornUserId: number): TargetList {
  const snapshots = { ...list.snapshots };
  delete snapshots[String(tornUserId)];
  return { entries: list.entries.filter((entry) => entry.tornUserId !== tornUserId), snapshots };
}

function patchEntry(list: TargetList, tornUserId: number, patch: Partial<TargetEntry>): TargetList {
  return {
    entries: list.entries.map((entry) => (entry.tornUserId === tornUserId ? { ...entry, ...patch } : entry)),
    snapshots: { ...list.snapshots },
  };
}

export function setTargetNote(list: TargetList, tornUserId: number, note: string): TargetList {
  return patchEntry(list, tornUserId, { note });
}

export function setTargetPinned(list: TargetList, tornUserId: number, pinned: boolean): TargetList {
  return patchEntry(list, tornUserId, { pinned });
}

export function setTargetTags(list: TargetList, tornUserId: number, tags: string[]): TargetList {
  return patchEntry(list, tornUserId, { tags });
}

/** Adds as many of the given entries as the cap allows, skipping duplicates. */
export function addTargetEntries(list: TargetList, entries: TargetEntry[]): { list: TargetList; added: number; skipped: number; capped: number } {
  const known = new Set(list.entries.map((entry) => entry.tornUserId));
  const next = [...list.entries];
  let added = 0, skipped = 0, capped = 0;
  for (const entry of entries) {
    if (known.has(entry.tornUserId)) { skipped += 1; continue; }
    if (next.length >= MAX_TARGETS) { capped += 1; continue; }
    next.push(entry);
    known.add(entry.tornUserId);
    added += 1;
  }
  return { list: { entries: next, snapshots: { ...list.snapshots } }, added, skipped, capped };
}

export function mergeSnapshots(list: TargetList, snapshots: TargetSnapshot[]): TargetList {
  const next = { ...list.snapshots };
  for (const snapshot of snapshots) next[String(snapshot.tornUserId)] = snapshot;
  return { entries: list.entries, snapshots: next };
}
