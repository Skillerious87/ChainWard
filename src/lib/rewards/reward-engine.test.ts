import { describe, expect, it } from "vitest";
import { developmentRewardScheme } from "./default-scheme";
import {
  analyzeRewardCoverage,
  calculateRewards,
  createRewardSnapshot,
  InvalidRewardSchemeError,
  validateRewardTiers,
} from "./reward-engine";

describe("reward calculation", () => {
  it.each([
    [0, 0],
    [5, 0],
    [6, 1],
    [15, 1],
    [16, 2],
    [25, 2],
    [26, 3],
    [35, 3],
    [36, 4],
    [45, 4],
    [46, 5],
    [137, 5],
  ])("maps %i hits to %i Xanax", (hits, expected) => {
    const result = calculateRewards(
      [{ tornUserId: 1, memberName: "Boundary Tester", hits }],
      developmentRewardScheme,
    );

    expect(result.members[0]?.rewards[0]?.amount).toBe(expected);
  });

  it("detects overlapping enabled tiers", () => {
    const tiers = developmentRewardScheme.tiers.map((tier) => ({ ...tier }));
    const second = tiers[1];
    if (!second) throw new Error("Fixture is missing its second tier.");
    second.minimumHits = 5;

    expect(validateRewardTiers(tiers)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "OVERLAPPING_RANGE" }),
      ]),
    );
    expect(() =>
      calculateRewards([], { ...developmentRewardScheme, tiers }),
    ).toThrow(InvalidRewardSchemeError);
  });

  it("supports one unlimited upper range", () => {
    expect(validateRewardTiers(developmentRewardScheme.tiers)).toEqual([]);
    const result = calculateRewards(
      [{ tornUserId: 99, memberName: "Runner", hits: 1000 }],
      developmentRewardScheme,
    );
    expect(result.members[0]?.tierId).toBe("tier-46-plus");
  });

  it("preserves a historical calculation when live rules change", () => {
    const calculation = calculateRewards(
      [{ tornUserId: 7, memberName: "Snapshot", hits: 46 }],
      developmentRewardScheme,
    );
    const snapshot = createRewardSnapshot(
      "chain-1",
      calculation,
      new Date("2026-01-01T00:00:00Z"),
    );
    calculation.members[0]!.rewards[0]!.amount = 999;

    expect(snapshot.members[0]?.rewards[0]?.amount).toBe(5);
    expect(snapshot.scheme.version).toBe(1);
  });
});

describe("reward coverage", () => {
  it("reports no gaps for a scheme that starts at zero and ends unlimited", () => {
    const coverage = analyzeRewardCoverage(developmentRewardScheme.tiers);

    expect(coverage.gaps).toEqual([]);
    expect(coverage.coversUnlimited).toBe(true);
    expect(coverage.enabledTierCount).toBe(6);
  });

  it("reports the hit counts left between two enabled tiers", () => {
    const tiers = developmentRewardScheme.tiers.map((tier) => ({ ...tier }));
    tiers[1] = { ...tiers[1]!, minimumHits: 9 };

    expect(analyzeRewardCoverage(tiers).gaps).toEqual([{ fromHits: 6, toHits: 8 }]);
  });

  it("reports an opening gap when the lowest tier does not start at zero", () => {
    const tiers = developmentRewardScheme.tiers.map((tier) => ({ ...tier }));
    tiers[0] = { ...tiers[0]!, minimumHits: 2 };

    expect(analyzeRewardCoverage(tiers).gaps).toEqual([{ fromHits: 0, toHits: 1 }]);
  });

  it("reports an open upper gap when every enabled tier is bounded", () => {
    const tiers = developmentRewardScheme.tiers.map((tier) => ({ ...tier }));
    tiers[5] = { ...tiers[5]!, maximumHits: 90 };
    const coverage = analyzeRewardCoverage(tiers);

    expect(coverage.coversUnlimited).toBe(false);
    expect(coverage.gaps).toEqual([{ fromHits: 91, toHits: null }]);
    expect(coverage.highestCoveredHits).toBe(90);
  });

  it("ignores disabled tiers when measuring coverage", () => {
    const tiers = developmentRewardScheme.tiers.map((tier) => ({ ...tier }));
    tiers[2] = { ...tiers[2]!, enabled: false };

    expect(analyzeRewardCoverage(tiers).gaps).toEqual([{ fromHits: 16, toHits: 25 }]);
    expect(analyzeRewardCoverage(tiers).enabledTierCount).toBe(5);
  });

  it("treats an empty scheme as covering nothing", () => {
    const coverage = analyzeRewardCoverage([]);

    expect(coverage.gaps).toEqual([{ fromHits: 0, toHits: null }]);
    expect(coverage.enabledTierCount).toBe(0);
  });
});
