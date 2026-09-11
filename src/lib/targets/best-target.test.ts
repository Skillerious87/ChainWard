import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentActor: vi.fn(),
  getConfiguredTornConnection: vi.fn(),
  readTargetList: vi.fn(),
  enrichWithFairFight: vi.fn(),
}));

vi.mock("@/lib/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/lib/torn/server-client", () => ({ getConfiguredTornConnection: mocks.getConfiguredTornConnection }));
vi.mock("./store", () => ({ readTargetList: mocks.readTargetList }));
vi.mock("./ffscouter", () => ({ enrichWithFairFight: mocks.enrichWithFairFight }));

import { getBestChainTarget } from "./best-target";
import type { TargetEntry, TargetSnapshot } from "./types";

function entry(tornUserId: number, pinned = false): TargetEntry {
  return { tornUserId, label: "", note: "", pinned, tags: [], addedAt: new Date().toISOString() };
}

function snapshot(tornUserId: number, over: Partial<TargetSnapshot> = {}): TargetSnapshot {
  return {
    tornUserId, name: `Target ${tornUserId}`, level: 20, factionId: null, factionName: "",
    position: "", status: { description: "Okay", state: "Okay", until: null, color: "green" },
    lastActionAt: 0, lastActionRelative: "", lastActionStatus: "", lifeCurrent: 5_000, lifeMaximum: 5_000,
    attackable: true, lastHit: null, hitYouBack: false, hitStats: null, bountyTotal: 0, bountyCount: 0,
    fetchedAt: new Date().toISOString(), ...over,
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentActor.mockResolvedValue({ tornUserId: 999, name: "Operator", isPlatformAdmin: false, profileImageUrl: null });
  mocks.enrichWithFairFight.mockResolvedValue(new Map());
});

describe("getBestChainTarget", () => {
  it("returns nothing when no faction connection is configured", async () => {
    mocks.getConfiguredTornConnection.mockResolvedValue(null);
    await expect(getBestChainTarget()).resolves.toEqual({ target: null, targetCount: 0 });
    expect(mocks.readTargetList).not.toHaveBeenCalled();
  });

  it("returns nothing when the target list is empty", async () => {
    mocks.getConfiguredTornConnection.mockResolvedValue({ factionId: 555 });
    mocks.readTargetList.mockResolvedValue({ entries: [], snapshots: {} });
    await expect(getBestChainTarget()).resolves.toEqual({ target: null, targetCount: 0 });
  });

  it("reports the target count but no pick when nobody on the list is attackable", async () => {
    mocks.getConfiguredTornConnection.mockResolvedValue({ factionId: 555 });
    mocks.readTargetList.mockResolvedValue({
      entries: [entry(1)],
      snapshots: { "1": snapshot(1, { status: { description: "In hospital", state: "Hospital", until: 0, color: "red" } }) },
    });
    await expect(getBestChainTarget()).resolves.toEqual({ target: null, targetCount: 1 });
  });

  it("picks the highest hit-priority attackable target and builds an attack link", async () => {
    mocks.getConfiguredTornConnection.mockResolvedValue({ factionId: 555 });
    mocks.readTargetList.mockResolvedValue({
      entries: [entry(1), entry(2, true)],
      snapshots: {
        // Fresh, no bounty, never hit — solid but unremarkable.
        "1": snapshot(1, { name: "Weak Pick" }),
        // Pinned gets a bonus on top of the same readiness/winnability, so this should win.
        "2": snapshot(2, { name: "Strong Pick" }),
      },
    });
    mocks.enrichWithFairFight.mockResolvedValue(new Map([
      [1, { tornUserId: 1, bsEstimate: 1_000, fairFight: 3, source: "test", lastUpdated: 0 }],
      [2, { tornUserId: 2, bsEstimate: 1_000, fairFight: 3, source: "test", lastUpdated: 0 }],
    ]));

    const result = await getBestChainTarget();
    expect(result.targetCount).toBe(2);
    expect(result.target?.tornUserId).toBe(2);
    expect(result.target?.name).toBe("Strong Pick");
    expect(result.target?.attackUrl).toBe("https://www.torn.com/page.php?sid=attack&user2ID=2");
    expect(result.target?.fairFight).toBe(3);
    // Every candidate here is attackable, so the redundant "Ready" reason is dropped.
    expect(result.target?.reasons).not.toContain("Ready");
  });

  it("still scores targets when Fair Fight enrichment fails", async () => {
    mocks.getConfiguredTornConnection.mockResolvedValue({ factionId: 555 });
    mocks.readTargetList.mockResolvedValue({ entries: [entry(1)], snapshots: { "1": snapshot(1) } });
    mocks.enrichWithFairFight.mockRejectedValue(new Error("ffscouter unavailable"));

    const result = await getBestChainTarget();
    expect(result.target?.tornUserId).toBe(1);
    expect(result.target?.fairFight).toBeNull();
  });
});
