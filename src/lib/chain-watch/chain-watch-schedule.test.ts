import { describe, expect, it } from "vitest";
import { findActiveSlot, findNextSlot, slotStatus } from "./chain-watch-schedule";

const base = Date.parse("2026-09-04T00:00:00.000Z");
const slot = (offsetMinutes: number, durationMinutes: number) => ({
  startAt: new Date(base + offsetMinutes * 60_000).toISOString(),
  endAt: new Date(base + (offsetMinutes + durationMinutes) * 60_000).toISOString(),
});

describe("findActiveSlot", () => {
  it("finds the slot covering now", () => {
    const slots = [slot(-60, 30), slot(0, 60), slot(120, 30)];
    expect(findActiveSlot(slots, base + 30 * 60_000)).toBe(slots[1]);
  });

  it("treats the end boundary as exclusive", () => {
    const slots = [slot(0, 60)];
    expect(findActiveSlot(slots, base + 60 * 60_000)).toBeNull();
  });

  it("returns null when nothing covers now", () => {
    const slots = [slot(-120, 30), slot(120, 30)];
    expect(findActiveSlot(slots, base)).toBeNull();
  });
});

describe("findNextSlot", () => {
  it("returns the earliest slot starting after now, regardless of input order", () => {
    const later = slot(180, 30);
    const soonest = slot(30, 30);
    const past = slot(-30, 20);
    expect(findNextSlot([later, past, soonest], base)).toBe(soonest);
  });

  it("returns null when nothing is upcoming", () => {
    expect(findNextSlot([slot(-60, 30)], base)).toBeNull();
  });
});

describe("slotStatus", () => {
  it("classifies upcoming, active, and past", () => {
    const target = slot(0, 60);
    expect(slotStatus(target, base - 1)).toBe("upcoming");
    expect(slotStatus(target, base)).toBe("active");
    expect(slotStatus(target, base + 59 * 60_000)).toBe("active");
    expect(slotStatus(target, base + 60 * 60_000)).toBe("past");
  });
});
