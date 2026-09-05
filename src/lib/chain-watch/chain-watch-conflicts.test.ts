import { describe, expect, it } from "vitest";
import { findChainWatchConflicts, windowsOverlap } from "./chain-watch-conflicts";

const base = Date.parse("2026-09-04T00:00:00.000Z");
const slot = (
  id: string,
  offsetMinutes: number,
  durationMinutes: number,
  primaryTornUserId: number,
  backupTornUserId: number | null = null,
) => ({
  id,
  startAt: new Date(base + offsetMinutes * 60_000).toISOString(),
  endAt: new Date(base + (offsetMinutes + durationMinutes) * 60_000).toISOString(),
  primaryTornUserId,
  backupTornUserId,
});

describe("windowsOverlap", () => {
  it("treats a shared boundary instant as not overlapping", () => {
    expect(windowsOverlap(slot("a", 0, 60, 1), slot("b", 60, 60, 2))).toBe(false);
  });

  it("detects a genuine overlap", () => {
    expect(windowsOverlap(slot("a", 0, 60, 1), slot("b", 30, 60, 2))).toBe(true);
  });
});

describe("findChainWatchConflicts", () => {
  it("flags the same member as primary on both sides", () => {
    const existing = [slot("a", 0, 60, 1)];
    const conflicts = findChainWatchConflicts(existing, slot("candidate", 30, 60, 1));
    expect(conflicts).toEqual([{ slotId: "a", tornUserId: 1, existingRole: "primary", candidateRole: "primary" }]);
  });

  it("flags every primary/backup crossover", () => {
    const existing = [slot("a", 0, 60, 1, 2)];
    expect(findChainWatchConflicts(existing, slot("c", 30, 60, 2, 1))).toEqual(
      expect.arrayContaining([
        { slotId: "a", tornUserId: 1, existingRole: "primary", candidateRole: "backup" },
        { slotId: "a", tornUserId: 2, existingRole: "backup", candidateRole: "primary" },
      ]),
    );
  });

  it("flags both sides' backups matching", () => {
    const existing = [slot("a", 0, 60, 1, 9)];
    expect(findChainWatchConflicts(existing, slot("c", 30, 60, 2, 9))).toEqual([
      { slotId: "a", tornUserId: 9, existingRole: "backup", candidateRole: "backup" },
    ]);
  });

  it("never treats two null backups as a match", () => {
    const existing = [slot("a", 0, 60, 1, null)];
    expect(findChainWatchConflicts(existing, slot("c", 30, 60, 2, null))).toEqual([]);
  });

  it("ignores non-overlapping slots even when a member matches", () => {
    const existing = [slot("a", 0, 60, 1)];
    expect(findChainWatchConflicts(existing, slot("c", 60, 60, 1))).toEqual([]);
  });

  it("excludes the slot being edited via excludeSlotId", () => {
    const existing = [slot("a", 0, 60, 1)];
    expect(findChainWatchConflicts(existing, { ...slot("a", 0, 60, 1), excludeSlotId: "a" })).toEqual([]);
  });

  it("returns every conflicting slot, not just the first", () => {
    const existing = [slot("a", 0, 60, 1), slot("b", 30, 60, 1)];
    const conflicts = findChainWatchConflicts(existing, slot("c", 15, 60, 1));
    expect(conflicts.map((conflict) => conflict.slotId).sort()).toEqual(["a", "b"]);
  });
});
