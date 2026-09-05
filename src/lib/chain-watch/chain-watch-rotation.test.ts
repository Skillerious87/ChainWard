import { describe, expect, it } from "vitest";
import { needsMaterialization, planRotationInstances, rotationWindowForDate, type ChainWatchRotationLike } from "./chain-watch-rotation";

// 2026-09-07T00:00:00.000Z is a Monday (bit 0 in the Mon-first weekdaysMask).
const MONDAY = Date.parse("2026-09-07T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
const EVERY_DAY = 0b111_1111;
const WEEKEND_ONLY = (1 << 5) | (1 << 6); // Sat + Sun

const members = (count: number) => Array.from({ length: count }, (_, index) => ({ tornUserId: index + 1, memberName: `Member ${index}` }));

function rotation(overrides: Partial<ChainWatchRotationLike> = {}): ChainWatchRotationLike {
  return {
    weekdaysMask: EVERY_DAY,
    startMinuteUtc: 0,
    endMinuteUtc: 60,
    members: members(4),
    effectiveFrom: new Date(MONDAY).toISOString(),
    effectiveUntil: null,
    cursorDate: null,
    cursorIndex: null,
    ...overrides,
  };
}

describe("rotationWindowForDate", () => {
  it("produces a same-day window when end is after start", () => {
    const window = rotationWindowForDate({ startMinuteUtc: 0, endMinuteUtc: 60 }, MONDAY);
    expect(window).toEqual({ startAt: "2026-09-07T00:00:00.000Z", endAt: "2026-09-07T01:00:00.000Z" });
  });

  it("crosses into the next day when end is at or before start", () => {
    const window = rotationWindowForDate({ startMinuteUtc: 22 * 60, endMinuteUtc: 6 * 60 }, MONDAY);
    expect(window).toEqual({ startAt: "2026-09-07T22:00:00.000Z", endAt: "2026-09-08T06:00:00.000Z" });
  });
});

describe("planRotationInstances", () => {
  it("cycles every-day members in round-robin order and starts exactly at effectiveFrom", () => {
    const plan = planRotationInstances(rotation(), MONDAY + 10 * DAY_MS);
    expect(plan.instances).toHaveLength(10);
    expect(plan.instances[0]?.date).toBe(new Date(MONDAY).toISOString());
    expect(plan.instances.map((instance) => instance.memberIndex)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
    expect(plan.nextCursorIndex).toBe(1);
    expect(plan.nextCursorDate).toBe(plan.instances.at(-1)?.date);
  });

  it("only advances the index on applicable weekdays, skipping the rest", () => {
    const plan = planRotationInstances(rotation({ weekdaysMask: WEEKEND_ONLY, members: members(2) }), MONDAY + 14 * DAY_MS);
    expect(plan.instances.map((instance) => new Date(instance.date).getUTCDay())).toEqual([6, 0, 6, 0]); // Sat, Sun, Sat, Sun
    expect(plan.instances.map((instance) => instance.memberIndex)).toEqual([0, 1, 0, 1]);
  });

  it("produces an overnight-crossing window for every generated instance", () => {
    const plan = planRotationInstances(rotation({ startMinuteUtc: 22 * 60, endMinuteUtc: 6 * 60 }), MONDAY + 2 * DAY_MS);
    expect(plan.instances[0]).toMatchObject({ startAt: "2026-09-07T22:00:00.000Z", endAt: "2026-09-08T06:00:00.000Z" });
  });

  it("stops generating once effectiveUntil has passed, even with horizon remaining", () => {
    const plan = planRotationInstances(rotation({ effectiveUntil: new Date(MONDAY + 2 * DAY_MS).toISOString() }), MONDAY + 30 * DAY_MS);
    expect(plan.instances).toHaveLength(3);
    expect(plan.instances.at(-1)?.date).toBe(new Date(MONDAY + 2 * DAY_MS).toISOString());
  });

  it("resumes the round robin from a non-null cursor instead of restarting at 0", () => {
    const plan = planRotationInstances(
      rotation({ members: members(3), cursorDate: new Date(MONDAY).toISOString(), cursorIndex: 1 }),
      MONDAY + 3 * DAY_MS,
    );
    expect(plan.instances.map((instance) => instance.memberIndex)).toEqual([2, 0]);
  });

  it("always assigns index 0 for a single-member rotation", () => {
    const plan = planRotationInstances(rotation({ members: members(1) }), MONDAY + 5 * DAY_MS);
    expect(plan.instances.every((instance) => instance.memberIndex === 0)).toBe(true);
  });

  it("returns nothing when the horizon ends before effectiveFrom", () => {
    const plan = planRotationInstances(rotation(), MONDAY - DAY_MS);
    expect(plan).toEqual({ instances: [], nextCursorDate: null, nextCursorIndex: null });
  });
});

describe("needsMaterialization", () => {
  it("is true when nothing has ever been generated", () => {
    expect(needsMaterialization(null, MONDAY, 7)).toBe(true);
  });

  it("is true once the cursor is within the refill threshold", () => {
    expect(needsMaterialization(new Date(MONDAY + 5 * DAY_MS).toISOString(), MONDAY, 7)).toBe(true);
  });

  it("is false while the cursor is well beyond the refill threshold", () => {
    expect(needsMaterialization(new Date(MONDAY + 20 * DAY_MS).toISOString(), MONDAY, 7)).toBe(false);
  });
});
