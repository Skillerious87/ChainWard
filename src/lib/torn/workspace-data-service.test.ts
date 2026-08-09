import { describe, expect, it } from "vitest";
import { mapReport } from "./workspace-data-service";

describe("chain report mapping", () => {
  it("derives chain hits only from qualifying leave, mug, and hospitalize attacks", () => {
    const report = {
      chainreport: {
        id: 10,
        faction_id: 20,
        start: 100,
        end: 200,
        details: { chain: 8, respect: 12.5, members: 2, targets: 7, war: 0, best: 2, leave: 2, mug: 1, hospitalize: 5, assists: 4, retaliations: 0, overseas: 0, draws: 0, escapes: 0, losses: 3 },
        bonuses: [],
        attackers: [{ id: 1, respect: { total: 10, average: 2, best: 4 }, attacks: { total: 12, leave: 2, mug: 1, hospitalize: 5, assists: 4, retaliations: 0, overseas: 0, draws: 0, escapes: 0, losses: 3, war: 0, bonuses: 0 } }],
        non_attackers: [],
      },
    };
    const members = { members: [{ id: 1, name: "Verified", status: { state: "Okay" } }] };
    const mapped = mapReport(report as never, members as never);
    expect(mapped.contributions[0]).toMatchObject({ name: "Verified", hits: 8, contribution: 100 });
  });
});
