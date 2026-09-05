import { describe, expect, it } from "vitest";
import { minutesFromPointerOffset, snapMinutes, splitSlotIntoDaySegments, weekStartUtcMs } from "./chain-watch-timeline-layout";

// A Monday.
const MONDAY = Date.parse("2026-09-07T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
const slot = (offsetMinutes: number, durationMinutes: number) => ({
  startAt: new Date(MONDAY + offsetMinutes * 60_000).toISOString(),
  endAt: new Date(MONDAY + (offsetMinutes + durationMinutes) * 60_000).toISOString(),
});

describe("weekStartUtcMs", () => {
  it("finds the Monday of the week containing a mid-week timestamp", () => {
    expect(weekStartUtcMs(MONDAY + 2 * DAY_MS)).toBe(MONDAY);
  });

  it("shifts by whole weeks with a weekOffset", () => {
    expect(weekStartUtcMs(MONDAY, 1)).toBe(MONDAY + 7 * DAY_MS);
    expect(weekStartUtcMs(MONDAY, -1)).toBe(MONDAY - 7 * DAY_MS);
  });
});

describe("splitSlotIntoDaySegments", () => {
  it("produces one segment for a same-day slot", () => {
    const segments = splitSlotIntoDaySegments(slot(600, 60), MONDAY);
    expect(segments).toEqual([{ dayIndex: 0, topPercent: (600 / 1_440) * 100, heightPercent: (60 / 1_440) * 100 }]);
  });

  it("produces two segments for an overnight-crossing slot inside the visible week", () => {
    const segments = splitSlotIntoDaySegments(slot(22 * 60, 8 * 60), MONDAY);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ dayIndex: 0, heightPercent: (120 / 1_440) * 100 });
    expect(segments[0]!.topPercent + segments[0]!.heightPercent).toBeCloseTo(100, 5);
    expect(segments[1]).toMatchObject({ dayIndex: 1, topPercent: 0, heightPercent: (360 / 1_440) * 100 });
  });

  it("clips to one segment when a slot crosses the visible week's edge", () => {
    // Sunday 22:00 (day index 6) crossing into the following Monday, outside this week.
    const sundayNight = slot(6 * DAY_MS / 60_000 + 22 * 60, 8 * 60);
    const segments = splitSlotIntoDaySegments(sundayNight, MONDAY);
    expect(segments).toEqual([{ dayIndex: 6, topPercent: (22 * 60 / 1_440) * 100, heightPercent: (120 / 1_440) * 100 }]);
  });

  it("returns nothing for a slot entirely outside the visible week", () => {
    expect(splitSlotIntoDaySegments(slot(14 * 24 * 60, 60), MONDAY)).toEqual([]);
  });
});

describe("minutesFromPointerOffset", () => {
  it("maps the column height range to 0-1439", () => {
    expect(minutesFromPointerOffset(0, 1_440)).toBe(0);
    expect(minutesFromPointerOffset(1_440, 1_440)).toBe(1_439);
    expect(minutesFromPointerOffset(720, 1_440)).toBe(720);
  });
});

describe("snapMinutes", () => {
  it("snaps to the nearest increment and clamps at the boundaries", () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(719)).toBe(720);
    expect(snapMinutes(720)).toBe(720);
    expect(snapMinutes(1_439)).toBe(1_439);
  });
});
