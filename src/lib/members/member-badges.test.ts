import { describe, expect, it } from "vitest";
import { AWARD_CATEGORIES, MEMBER_BADGES, awardCitationError, isMemberBadgeId } from "./member-badges";

describe("faction award catalogue", () => {
  it("retains existing award identifiers and gives every distinction clear criteria", () => {
    for (const id of ["VANGUARD", "CHAIN_SENTINEL", "STEADFAST", "MENTOR", "FACTION_SERVICE", "MILESTONE"]) expect(isMemberBadgeId(id)).toBe(true);
    expect(new Set(MEMBER_BADGES.map((badge) => badge.id)).size).toBe(MEMBER_BADGES.length);
    for (const category of AWARD_CATEGORIES) expect(MEMBER_BADGES.filter((badge) => badge.category === category).length).toBeGreaterThan(0);
    for (const badge of MEMBER_BADGES) {
      expect(badge.criteria.length).toBeGreaterThan(30);
      expect(badge.prompt.length).toBeGreaterThan(30);
    }
    expect(isMemberBadgeId("UNVERIFIED_BADGE")).toBe(false);
  });

  it("validates the trimmed citation at the same limits as submission", () => {
    expect(awardCitationError("          ")).toBeTruthy();
    expect(awardCitationError("  too short  ")).toBeTruthy();
    expect(awardCitationError("  Kept the chain alive.  ")).toBeNull();
    expect(awardCitationError("x".repeat(600))).toBeNull();
    expect(awardCitationError("x".repeat(601))).toBeTruthy();
  });
});
