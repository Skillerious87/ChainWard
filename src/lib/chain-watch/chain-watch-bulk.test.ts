import { describe, expect, it } from "vitest";
import { planDuplicateSlots } from "./chain-watch-bulk";

const base = Date.parse("2026-09-07T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
const WEEK_MS = 7 * DAY_MS;
const slot = (id: string, offsetMinutes: number, durationMinutes: number, rotationId: string | null = null) => ({
  id,
  startAt: new Date(base + offsetMinutes * 60_000).toISOString(),
  endAt: new Date(base + (offsetMinutes + durationMinutes) * 60_000).toISOString(),
  rotationId,
});

describe("planDuplicateSlots", () => {
  it("includes a slot exactly at the range start and excludes one exactly at the range end", () => {
    const slots = [slot("start", 0, 60), slot("end", 60, 60)];
    const planned = planDuplicateSlots(slots, base, base + 60 * 60_000, DAY_MS);
    expect(planned.map((item) => item.sourceSlotId)).toEqual(["start"]);
  });

  it("excludes rotation-generated slots", () => {
    const slots = [slot("manual", 0, 60, null), slot("generated", 30, 60, "rotation-1")];
    const planned = planDuplicateSlots(slots, base, base + DAY_MS, DAY_MS);
    expect(planned.map((item) => item.sourceSlotId)).toEqual(["manual"]);
  });

  it("returns nothing for an empty range", () => {
    const slots = [slot("a", 0, 60)];
    expect(planDuplicateSlots(slots, base + DAY_MS, base + DAY_MS, DAY_MS)).toEqual([]);
  });

  it("shifts by a day and by a week correctly", () => {
    const slots = [slot("a", 0, 60)];
    const [dayShift] = planDuplicateSlots(slots, base, base + DAY_MS, DAY_MS);
    const [weekShift] = planDuplicateSlots(slots, base, base + DAY_MS, WEEK_MS);
    expect(dayShift).toMatchObject({ startAt: "2026-09-08T00:00:00.000Z", endAt: "2026-09-08T01:00:00.000Z" });
    expect(weekShift).toMatchObject({ startAt: "2026-09-14T00:00:00.000Z", endAt: "2026-09-14T01:00:00.000Z" });
  });
});
