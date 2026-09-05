import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalDatabase, openLocalDatabase } from "@/lib/data/local-database";
import {
  createChainWatchRotation,
  deleteChainWatchRotation,
  ensureRotationsMaterialized,
  listChainWatchRotations,
  updateChainWatchRotation,
  type ChainWatchRotationInput,
} from "./chain-watch-rotation-store";

// A Monday, so an every-day mask starts cleanly at the beginning of a week.
const NOW = Date.parse("2026-09-07T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
const FACTION_ID = 51_393;
const EVERY_DAY = 0b111_1111;

function baseInput(overrides: Partial<ChainWatchRotationInput> = {}): ChainWatchRotationInput {
  return {
    label: "Night Guard",
    weekdaysMask: EVERY_DAY,
    startMinuteUtc: 0,
    endMinuteUtc: 60,
    members: [{ tornUserId: 1, memberName: "A" }, { tornUserId: 2, memberName: "B" }],
    backupTornUserId: null,
    backupMemberName: null,
    note: null,
    effectiveFrom: new Date(NOW).toISOString(),
    effectiveUntil: null,
    ...overrides,
  };
}

function countSlots(rotationId?: string): number {
  const database = openLocalDatabase();
  if (!database) return 0;
  try {
    const row = rotationId
      ? database.prepare("SELECT COUNT(*) AS total FROM chain_watch_slots WHERE rotation_id = ?").get(rotationId)
      : database.prepare("SELECT COUNT(*) AS total FROM chain_watch_slots").get();
    return (row as { total: number }).total;
  } finally {
    database.close();
  }
}

function slotRows(rotationId: string): Array<{ start_at: string; primary_member_name: string; rotation_id: string | null }> {
  const database = openLocalDatabase();
  if (!database) return [];
  try {
    return database.prepare("SELECT start_at, primary_member_name, rotation_id FROM chain_watch_slots WHERE rotation_id = ? ORDER BY start_at ASC")
      .all(rotationId) as unknown as Array<{ start_at: string; primary_member_name: string; rotation_id: string | null }>;
  } finally {
    database.close();
  }
}

function touchSlot(startAt: string): void {
  const database = openLocalDatabase();
  if (!database) return;
  try {
    database.prepare("UPDATE chain_watch_slots SET updated_at = ? WHERE start_at = ?").run(new Date(NOW + 999).toISOString(), startAt);
  } finally {
    database.close();
  }
}

function resetCursor(rotationId: string): void {
  const database = openLocalDatabase();
  if (!database) return;
  try {
    database.prepare("UPDATE chain_watch_rotations SET cursor_date = NULL, cursor_index = NULL WHERE id = ?").run(rotationId);
  } finally {
    database.close();
  }
}

describe.sequential("chain watch rotation store", () => {
  const originalPath = process.env.CHAINWARD_LOCAL_DB_PATH;
  const originalAppDataDirectory = process.env.CHAINWARD_APP_DATA_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let directory: string | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalPath === undefined) delete process.env.CHAINWARD_LOCAL_DB_PATH;
    else process.env.CHAINWARD_LOCAL_DB_PATH = originalPath;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalAppDataDirectory === undefined) delete process.env.CHAINWARD_APP_DATA_DIR;
    else process.env.CHAINWARD_APP_DATA_DIR = originalAppDataDirectory;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = null;
  });

  function freshDatabase(prefix: string): void {
    directory = mkdtempSync(path.join(tmpdir(), prefix));
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(directory, "rotation.sqlite");
    process.env.CHAINWARD_APP_DATA_DIR = path.join(directory, "appdata");
    delete process.env.DATABASE_URL;
    createLocalDatabase();
  }

  it("materializes on first call and is a no-op once comfortably inside the refill threshold", async () => {
    freshDatabase("chainward-rotation-basic-");
    const rotation = await createChainWatchRotation(FACTION_ID, baseInput(), 999);

    await ensureRotationsMaterialized(FACTION_ID, 10, 7);
    expect(countSlots(rotation.id)).toBe(10);
    const [stored] = await listChainWatchRotations(FACTION_ID);
    expect(stored?.cursorDate).toBe(new Date(NOW + 9 * DAY_MS).toISOString());

    await ensureRotationsMaterialized(FACTION_ID, 10, 7);
    expect(countSlots(rotation.id)).toBe(10);
  });

  it("tops up further once the cursor runs back inside the refill threshold", async () => {
    freshDatabase("chainward-rotation-topup-");
    const rotation = await createChainWatchRotation(FACTION_ID, baseInput(), 999);
    await ensureRotationsMaterialized(FACTION_ID, 10, 7);
    expect(countSlots(rotation.id)).toBe(10);

    // Advancing 5 days leaves only 4 days of runway on a 10-day cursor -- inside a 7-day threshold.
    vi.setSystemTime(NOW + 5 * DAY_MS);
    await ensureRotationsMaterialized(FACTION_ID, 10, 7);
    expect(countSlots(rotation.id)).toBe(15);
  });

  it("does not create duplicate slots when materialization re-runs against a stale cursor", async () => {
    freshDatabase("chainward-rotation-race-");
    const rotation = await createChainWatchRotation(FACTION_ID, baseInput(), 999);
    await ensureRotationsMaterialized(FACTION_ID, 5, 7);
    expect(countSlots(rotation.id)).toBe(5);

    // Simulates a second request that read the rotation before this one's
    // cursor update committed, and so re-plans the same date range.
    resetCursor(rotation.id);
    await ensureRotationsMaterialized(FACTION_ID, 5, 7);
    expect(countSlots(rotation.id)).toBe(5);
  });

  it("regenerates only the future when edited, leaving already-started instances untouched, and reports manual adjustments", async () => {
    freshDatabase("chainward-rotation-edit-");
    const rotation = await createChainWatchRotation(FACTION_ID, baseInput(), 999);
    await ensureRotationsMaterialized(FACTION_ID, 10, 7);
    const pastPrimaries = slotRows(rotation.id).map((row) => row.primary_member_name);

    // Hand-tweak the day-5 instance before editing the rotation.
    touchSlot(new Date(NOW + 5 * DAY_MS).toISOString());

    // 3 days and 30 minutes in: days 0-3 are already started (day 3 began 30
    // minutes ago), days 4-9 are still future -- clear of the exact-instant
    // boundary a plain "+3 days" would land on relative to each slot's start.
    const editAt = NOW + 3 * DAY_MS + 30 * 60_000;
    vi.setSystemTime(editAt);
    const { manuallyAdjustedCount } = await updateChainWatchRotation(FACTION_ID, rotation.id, baseInput({
      members: [{ tornUserId: 3, memberName: "C" }],
    }));
    expect(manuallyAdjustedCount).toBe(1);

    // Days 0-3 (already started) keep their original A/B pattern untouched.
    const remaining = slotRows(rotation.id);
    expect(remaining).toHaveLength(4);
    expect(remaining.map((row) => row.primary_member_name)).toEqual(pastPrimaries.slice(0, 4));

    // Regenerating under the new single-member pattern resumes from the rolled-back cursor.
    await ensureRotationsMaterialized(FACTION_ID, 10, 7);
    const regenerated = slotRows(rotation.id).filter((row) => Date.parse(row.start_at) > editAt);
    expect(regenerated.length).toBeGreaterThan(0);
    expect(regenerated.every((row) => row.primary_member_name === "C")).toBe(true);
  });

  it("deletes future instances and orphans past ones on delete", async () => {
    freshDatabase("chainward-rotation-delete-");
    const rotation = await createChainWatchRotation(FACTION_ID, baseInput(), 999);
    await ensureRotationsMaterialized(FACTION_ID, 10, 7);

    vi.setSystemTime(NOW + 3 * DAY_MS + 30 * 60_000);
    await deleteChainWatchRotation(FACTION_ID, rotation.id);

    const database = openLocalDatabase();
    expect(database).not.toBeNull();
    try {
      const remaining = database!.prepare("SELECT rotation_id FROM chain_watch_slots ORDER BY start_at ASC").all() as unknown as Array<{ rotation_id: string | null }>;
      expect(remaining).toHaveLength(4);
      expect(remaining.every((row) => row.rotation_id === null)).toBe(true);
    } finally {
      database!.close();
    }
    expect(await listChainWatchRotations(FACTION_ID)).toEqual([]);
  });
});
