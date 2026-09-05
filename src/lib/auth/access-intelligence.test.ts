import { describe, expect, it } from "vitest";
import { analyzeAccessChange, analyzeAccessPosture } from "./access-intelligence";
import type { FactionAccessAssignment } from "./faction-access-store";

describe("access change intelligence", () => {
  it("identifies no-op changes so they do not create audit noise", () => {
    const impact = analyzeAccessChange({ role: "VIEWER", status: "ACTIVE" }, { role: "VIEWER", status: "ACTIVE" });
    expect(impact.changed).toBe(false);
    expect(impact.gained).toEqual([]);
  });

  it("flags administrator grants as high trust and explains the added permissions", () => {
    const impact = analyzeAccessChange({ role: "VIEWER", status: "ACTIVE" }, { role: "ADMINISTRATOR", status: "ACTIVE" });
    expect(impact.tone).toBe("danger");
    expect(impact.gained.map((item) => item.permission)).toEqual(["oc:review", "chain:manage", "payout:manage", "rewards:manage", "members:manage", "faction:backup"]);
  });

  it("treats a downgrade as a positive least-privilege change", () => {
    const impact = analyzeAccessChange({ role: "ADMINISTRATOR", status: "ACTIVE" }, { role: "CHAIN_MANAGER", status: "ACTIVE" });
    expect(impact.tone).toBe("positive");
    expect(impact.removed.map((item) => item.permission)).toEqual(["oc:review", "rewards:manage", "members:manage", "faction:backup"]);
  });

  it("models suspension as removing every effective permission", () => {
    const impact = analyzeAccessChange({ role: "CHAIN_MANAGER", status: "ACTIVE" }, { role: "CHAIN_MANAGER", status: "SUSPENDED" });
    expect(impact.title).toContain("suspended");
    expect(impact.removed).toHaveLength(3);
  });
});

describe("access posture intelligence", () => {
  const assignment = (overrides: Partial<FactionAccessAssignment> = {}): FactionAccessAssignment => ({ tornUserId: 1, memberName: "Alpha", role: "VIEWER", status: "ACTIVE", assignedByTornId: 9, updatedAt: "2026-08-15T12:00:00.000Z", ...overrides });

  it("prioritizes stale holders over lower-risk observations", () => {
    const posture = analyzeAccessPosture([assignment({ tornUserId: 2, role: "ADMINISTRATOR" })], new Set([1]), true, true);
    expect(posture.tone).toBe("critical");
    expect(posture.staleCount).toBe(1);
    expect(posture.action).toBe("assignments");
  });

  it("calls out unusually broad administrator coverage", () => {
    const assignments = [1, 2, 3].map((tornUserId) => assignment({ tornUserId, role: "ADMINISTRATOR" }));
    const posture = analyzeAccessPosture(assignments, new Set([1, 2, 3]), true, true);
    expect(posture.tone).toBe("review");
    expect(posture.administratorCount).toBe(3);
  });

  it("reports a clean posture when assignments are active and roster-backed", () => {
    expect(analyzeAccessPosture([assignment()], new Set([1]), true, true).tone).toBe("healthy");
  });
});
