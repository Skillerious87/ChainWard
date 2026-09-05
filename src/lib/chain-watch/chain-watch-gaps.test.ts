import { describe, expect, it } from "vitest";
import { findChainWatchGaps } from "./chain-watch-gaps";

const base = Date.parse("2026-09-04T00:00:00.000Z");
const HOUR = 3_600_000;
const slot = (offsetMinutes: number, durationMinutes: number) => ({
  startAt: new Date(base + offsetMinutes * 60_000).toISOString(),
  endAt: new Date(base + (offsetMinutes + durationMinutes) * 60_000).toISOString(),
});
const iso = (ms: number) => new Date(ms).toISOString();

describe("findChainWatchGaps", () => {
  it("reports the whole window uncovered when there are no slots", () => {
    expect(findChainWatchGaps([], base, 6 * HOUR)).toEqual([{ startAt: iso(base), endAt: iso(base + 6 * HOUR) }]);
  });

  it("reports no gaps for back-to-back slots", () => {
    const slots = [slot(0, 60), slot(60, 60)];
    expect(findChainWatchGaps(slots, base, 2 * HOUR)).toEqual([]);
  });

  it("clips the gap start to now for a currently active slot", () => {
    const slots = [slot(-30, 90)];
    expect(findChainWatchGaps(slots, base, 2 * HOUR)).toEqual([{ startAt: iso(base + 60 * 60_000), endAt: iso(base + 2 * HOUR) }]);
  });

  it("reports no trailing gap when coverage extends past the lookahead", () => {
    const slots = [slot(0, 240)];
    expect(findChainWatchGaps(slots, base, 2 * HOUR)).toEqual([]);
  });

  it("merges overlapping slots into one covered interval", () => {
    const slots = [slot(0, 60), slot(30, 60)];
    expect(findChainWatchGaps(slots, base, 90 * 60_000)).toEqual([]);
  });

  it("reports a gap between two covered stretches", () => {
    const slots = [slot(0, 30), slot(60, 30)];
    expect(findChainWatchGaps(slots, base, 90 * 60_000)).toEqual([{ startAt: iso(base + 30 * 60_000), endAt: iso(base + 60 * 60_000) }]);
  });

  it("reports a trailing gap when the last slot ends before the window closes", () => {
    const slots = [slot(0, 60)];
    expect(findChainWatchGaps(slots, base, 2 * HOUR)).toEqual([{ startAt: iso(base + 60 * 60_000), endAt: iso(base + 2 * HOUR) }]);
  });
});
