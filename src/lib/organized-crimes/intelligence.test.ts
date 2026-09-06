import { describe, expect, it } from "vitest";
import type { TornRosterMember } from "@/lib/torn/workspace-types";
import { collectOwnRoles, reviewMembers } from "./intelligence";
import type { CrimeFeed, MemberIntel, OrganizedCrime } from "./types";

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const MINUTE = 60_000;
const DAY = 86_400_000;

function member(tornId: number, overrides: Partial<TornRosterMember> = {}): TornRosterMember {
  return {
    tornId,
    name: `Member ${tornId}`,
    position: "Member",
    level: 40,
    daysInFaction: 200,
    lastAction: "1 minute ago",
    lastActionAt: Math.floor(NOW / 1_000) - 60,
    status: "Okay",
    statusDescription: "Okay",
    statusUntil: null,
    ...overrides,
  };
}

function slot(overrides: Partial<OrganizedCrime["slots"][number]> = {}): OrganizedCrime["slots"][number] {
  return {
    position: "Robber",
    position_info: { id: "1", label: "Robber #1" },
    user: null,
    checkpoint_pass_rate: null,
    item_requirement: null,
    ...overrides,
  };
}

function crime(overrides: Partial<OrganizedCrime> = {}): OrganizedCrime {
  return {
    id: 900,
    name: "Stage Robbery",
    difficulty: 7,
    status: "Recruiting",
    created_at: Math.floor((NOW - DAY) / 1_000),
    expired_at: Math.floor((NOW + DAY) / 1_000),
    executed_at: null,
    ready_at: null,
    slots: [slot()],
    ...overrides,
  };
}

function liveFeed(crimes: OrganizedCrime[], overrides: Partial<CrimeFeed> = {}): CrimeFeed {
  return { crimes, available: true, complete: true, fetchedAt: new Date(NOW - MINUTE).toISOString(), message: "ok", ...overrides };
}

function emptyHistory(overrides: Partial<CrimeFeed> = {}): CrimeFeed {
  return { crimes: [], available: true, complete: true, fetchedAt: new Date(NOW - MINUTE).toISOString(), message: "ok", ...overrides };
}

function reviewOne(...args: Parameters<typeof reviewMembers>) {
  const [review] = reviewMembers(...args);
  if (!review) throw new Error("expected exactly one review");
  return review;
}

function intel(tornUserId: number, overrides: Partial<MemberIntel> = {}): MemberIntel {
  return {
    factionId: 5,
    tornUserId,
    stats: { strength: 1_000, defense: 1_000, speed: 1_000, dexterity: 1_000, total: 4_000 },
    statsAt: new Date(NOW - DAY).toISOString(),
    roles: [],
    rolesMessage: "",
    source: "torn",
    ...overrides,
  };
}

describe("collectOwnRoles", () => {
  it("keeps only recruiting/planning slots that are empty or the user's own, with a pass rate", () => {
    const crimes: OrganizedCrime[] = [
      crime({ id: 1, status: "Recruiting", slots: [
        slot({ position_info: { id: "1", label: "Robber #1" }, checkpoint_pass_rate: 82 }),
        slot({ position_info: { id: "2", label: "Robber #2" }, user: { id: 42, joined_at: 1 }, checkpoint_pass_rate: 71 }),
        slot({ position_info: { id: "3", label: "Lookout" }, user: { id: 99, joined_at: 1 }, checkpoint_pass_rate: 90 }),
        slot({ position_info: { id: "4", label: "Driver" }, checkpoint_pass_rate: null }),
      ] }),
      crime({ id: 2, status: "Successful", slots: [slot({ checkpoint_pass_rate: 95 })] }),
    ];

    const roles = collectOwnRoles(crimes, 42, new Date(NOW).toISOString());

    expect(roles.map((role) => role.positionLabel)).toEqual(["Robber #1", "Robber #2"]);
    expect(roles[0]).toMatchObject({ crimeId: 1, positionId: "1", passRate: 82, difficulty: 7 });
  });
});

describe("reviewMembers", () => {
  it("rejects an out-of-range CPR threshold", () => {
    expect(() => reviewMembers([], [], liveFeed([]), emptyHistory(), NOW, 150)).toThrow();
    expect(() => reviewMembers([], [], liveFeed([]), emptyHistory(), NOW, -1)).toThrow();
    expect(() => reviewMembers([], [], liveFeed([]), emptyHistory(), NOW, Number.NaN)).toThrow();
  });

  it("returns no suggestions when the live feed is unavailable", () => {
    const down = liveFeed([crime()], { available: false });
    const review = reviewOne([member(1)], [intel(1)], down, emptyHistory(), NOW);
    expect(review.suggestions).toEqual([]);
    expect(review.reason).toMatch(/live OC feed is unavailable/i);
  });

  it("still suggests from a stale-but-available live feed (no hard fetch cutoff)", () => {
    const stale = liveFeed([crime({ id: 21 })], { fetchedAt: new Date(NOW - 30 * MINUTE).toISOString() });
    const record = intel(1, { roles: [{
      crimeId: 21, crimeName: "Stage Robbery", difficulty: 7,
      positionId: "1", positionLabel: "Robber #1", passRate: 88,
      observedAt: new Date(NOW - 5 * MINUTE).toISOString(),
    }] });
    const review = reviewOne([member(1)], [record], stale, emptyHistory(), NOW, 70);
    expect(review.suggestions).toHaveLength(1);
  });

  it("marks a member already occupying an active slot as assigned", () => {
    const active = crime({ id: 12, slots: [slot({ user: { id: 1, joined_at: 1 } })] });
    const review = reviewOne([member(1)], [intel(1)], liveFeed([active]), emptyHistory(), NOW);
    expect(review.assignment).toBe("Stage Robbery #12");
    expect(review.reason).toMatch(/already assigned/i);
  });

  it("suggests an open slot from fresh personal checkpoint evidence", () => {
    const open = crime({ id: 20, slots: [slot({ position_info: { id: "1", label: "Robber #1" }, item_requirement: { id: 55, is_available: true, is_reusable: false } })] });
    const record = intel(1, { roles: [{
      crimeId: 20, crimeName: "Stage Robbery", difficulty: 7,
      positionId: "1", positionLabel: "Robber #1", passRate: 88,
      observedAt: new Date(NOW - 5 * MINUTE).toISOString(),
    }] });

    const review = reviewOne([member(1)], [record], liveFeed([open]), emptyHistory(), NOW, 70);

    expect(review.suggestions).toHaveLength(1);
    expect(review.suggestions[0]).toMatchObject({ crimeId: 20, evidence: "self-report", itemId: 55 });
    expect(review.suggestions[0]?.passRate).toBeGreaterThanOrEqual(80);
    expect(review.reason).toMatch(/recency-weighted CPR/i);
  });

  it("uses completed-crime history when there is no self-report", () => {
    const open = crime({ id: 30, slots: [slot({ position_info: { id: "2", label: "Hacker" } })] });
    const history: CrimeFeed = {
      crimes: [crime({
        id: 999, status: "Successful", difficulty: 7, name: "Stage Robbery",
        executed_at: Math.floor((NOW - 2 * DAY) / 1_000),
        slots: [slot({ position_info: { id: "2", label: "Hacker" }, user: { id: 1, joined_at: 1 }, checkpoint_pass_rate: 79 })],
      })],
      available: true, complete: true, fetchedAt: new Date(NOW - MINUTE).toISOString(), message: "ok",
    };

    const review = reviewOne([member(1)], [intel(1)], liveFeed([open]), history, NOW, 70);

    expect(review.suggestions).toHaveLength(1);
    expect(review.suggestions[0]).toMatchObject({ evidence: "history" });
    expect(review.suggestions[0]?.passRate).toBeGreaterThanOrEqual(70);
  });

  it("blends a stale self-report with fresh history into one weighted entry", () => {
    const open = crime({ id: 31, slots: [slot({ position_info: { id: "2", label: "Hacker" } })] });
    const record = intel(1, { roles: [{
      crimeId: 31, crimeName: "Stage Robbery", difficulty: 7,
      positionId: "2", positionLabel: "Hacker", passRate: 91,
      observedAt: new Date(NOW - 40 * DAY).toISOString(),
    }] });
    const history: CrimeFeed = {
      crimes: [crime({
        id: 998, status: "Successful", difficulty: 7, name: "Stage Robbery",
        executed_at: Math.floor((NOW - 2 * DAY) / 1_000),
        slots: [slot({ position_info: { id: "2", label: "Hacker" }, user: { id: 1, joined_at: 1 }, checkpoint_pass_rate: 79 })],
      })],
      available: true, complete: true, fetchedAt: new Date(NOW - MINUTE).toISOString(), message: "ok",
    };

    const review = reviewOne([member(1)], [record], liveFeed([open]), history, NOW, 70);
    expect(review.suggestions).toHaveLength(1);
    // Fresh history outweighs the 40-day-old self-report.
    expect(review.suggestions[0]?.passRate).toBeLessThan(88);
  });

  it("drops evidence below the CPR threshold", () => {
    const open = crime({ id: 40, slots: [slot({ position_info: { id: "1", label: "Robber #1" } })] });
    const record = intel(1, { roles: [{
      crimeId: 40, crimeName: "Stage Robbery", difficulty: 7,
      positionId: "1", positionLabel: "Robber #1", passRate: 55,
      observedAt: new Date(NOW - MINUTE).toISOString(),
    }] });

    const review = reviewOne([member(1)], [record], liveFeed([open]), emptyHistory(), NOW, 70);

    expect(review.suggestions).toEqual([]);
    expect(review.reason).toMatch(/none of it meets the current threshold/i);
  });

  it("skips a recruiting crime whose recruitment window has expired", () => {
    const expired = crime({ id: 50, status: "Recruiting", expired_at: Math.floor((NOW - MINUTE) / 1_000), slots: [slot({ checkpoint_pass_rate: null })] });
    const record = intel(1, { roles: [{
      crimeId: 50, crimeName: "Stage Robbery", difficulty: 7,
      positionId: "1", positionLabel: "Robber #1", passRate: 99,
      observedAt: new Date(NOW - MINUTE).toISOString(),
    }] });

    const review = reviewOne([member(1)], [record], liveFeed([expired]), emptyHistory(), NOW, 70);
    expect(review.suggestions).toEqual([]);
  });

  it("reports battle-stat freshness against the 7-day window", () => {
    const fresh = intel(1, { statsAt: new Date(NOW - 2 * DAY).toISOString() });
    const stale = intel(2, { statsAt: new Date(NOW - 8 * DAY).toISOString() });
    const reviews = reviewMembers([member(1), member(2)], [fresh, stale], liveFeed([]), emptyHistory(), NOW);
    expect(reviews.find((review) => review.member.tornId === 1)?.statsFresh).toBe(true);
    expect(reviews.find((review) => review.member.tornId === 2)?.statsFresh).toBe(false);
  });
});
