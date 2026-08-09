import { describe, expect, it } from "vitest";
import { summarizeChainHistory, summarizeRoster } from "./analytics";

describe("analytics intelligence", () => {
  it("compares equal recent and prior chain samples", () => {
    const history = [120, 120, 120, 100, 100, 100].map((hits, index) => ({
      id: 6 - index,
      hits,
      respect: hits / 10,
      startedAt: index * 100,
      endedAt: index * 100 + 50,
    }));
    const summary = summarizeChainHistory(history);
    expect(summary.trendPercent).toBe(20);
    expect(summary.averageHits).toBe(110);
    expect(summary.bestChain?.hits).toBe(120);
    expect(summary.respectPerHit).toBeCloseTo(0.1);
  });

  it("reports roster activity and grouped status counts", () => {
    const checkedAt = "2026-08-09T12:00:00.000Z";
    const now = Date.parse(checkedAt) / 1_000;
    const roster = [
      { tornId: 1, name: "One", position: "Leader", level: 1, daysInFaction: 1, lastAction: "now", lastActionAt: now - 60, status: "Okay", statusDescription: "", statusUntil: null },
      { tornId: 2, name: "Two", position: "Member", level: 1, daysInFaction: 1, lastAction: "hour", lastActionAt: now - 3_000, status: "Hospital", statusDescription: "", statusUntil: null },
      { tornId: 3, name: "Three", position: "Member", level: 1, daysInFaction: 1, lastAction: "old", lastActionAt: now - 90_000, status: "Okay", statusDescription: "", statusUntil: null },
    ];
    const summary = summarizeRoster(roster, checkedAt);
    expect(summary.active15Minutes).toBe(1);
    expect(summary.activeHour).toBe(2);
    expect(summary.inactiveDay).toBe(1);
    expect(summary.statuses[0]).toMatchObject({ label: "Okay", count: 2 });
    expect(summary.positions[0]).toMatchObject({ label: "Member", count: 2 });
  });
});
