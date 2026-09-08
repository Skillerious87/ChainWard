import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfiguredTornConnection: vi.fn(),
  getUserProfileById: vi.fn(),
  getMyAttacks: vi.fn(),
  getUserBounties: vi.fn(),
}));

vi.mock("@/lib/torn/server-client", () => ({ getConfiguredTornConnection: mocks.getConfiguredTornConnection }));

import { buildHitIndex, refreshTargets } from "./data-service";
import type { TargetEntry, TargetSnapshot } from "./types";

function profile(id: number, overrides: Record<string, unknown> = {}) {
  return {
    value: {
      profile: {
        id,
        name: `Target ${id}`,
        level: 42,
        last_action: { status: "Offline", timestamp: 1_700_000_000, relative: "1 hour ago" },
        status: { description: "Okay", details: null, state: "Okay", until: null, color: "green" },
        faction: { faction_id: 555, faction_name: "Rivals", position: "Member", days_in_faction: 90 },
        life: { current: 4_500, maximum: 5_000 },
        ...overrides,
      },
    },
    fetchedAt: Date.now(),
  };
}

function entry(tornUserId: number): TargetEntry {
  return { tornUserId, label: `Target ${tornUserId}`, note: "", pinned: false, tags: [], addedAt: new Date().toISOString() };
}

function snapshot(tornUserId: number, over: Partial<TargetSnapshot> = {}): TargetSnapshot {
  return {
    tornUserId, name: "S", level: 10, factionId: null, factionName: "", position: "",
    status: { description: "Okay", state: "Okay", until: null, color: "green" },
    lastActionAt: 0, lastActionRelative: "", lastActionStatus: "", lifeCurrent: 0, lifeMaximum: 0,
    attackable: true, lastHit: null, hitYouBack: false, bountyTotal: 0, bountyCount: 0, fetchedAt: new Date().toISOString(), ...over,
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getMyAttacks.mockResolvedValue({ value: { attacks: [] } });
  mocks.getUserBounties.mockResolvedValue({ value: { bounties: [] } });
  mocks.getConfiguredTornConnection.mockResolvedValue({
    tornUserId: 999,
    client: { dataMode: "torn", getUserProfileById: mocks.getUserProfileById, getMyAttacks: mocks.getMyAttacks, getUserBounties: mocks.getUserBounties },
  });
});

describe("buildHitIndex", () => {
  it("records the operator's most recent hit per target and flags a hit back", () => {
    const response = {
      attacks: [
        { id: 1, started: 200, ended: 260, attacker: { id: 20 }, defender: { id: 999 }, result: "Attacked", respect_gain: 0, respect_loss: 3, chain: 0 },
        { id: 2, started: 100, ended: 160, attacker: { id: 999 }, defender: { id: 20 }, result: "Mugged", respect_gain: 12.5, respect_loss: 0, chain: 4 },
        { id: 3, started: 90, ended: 150, attacker: { id: 999 }, defender: { id: 21 }, result: "Hospitalized", respect_gain: 8, respect_loss: 0, chain: 1 },
      ],
    };
    const index = buildHitIndex(response as never, 999);
    expect(index.get(20)?.lastHit).toEqual({ at: 160, result: "Mugged", respect: 12.5 });
    expect(index.get(20)?.hitYouBack).toBe(true);
    expect(index.get(21)?.lastHit?.result).toBe("Hospitalized");
    expect(index.get(21)?.hitYouBack).toBe(false);
  });
});

describe("refreshTargets", () => {
  it("reports a disconnected result when no Torn connection is configured", async () => {
    mocks.getConfiguredTornConnection.mockResolvedValue(null);
    const result = await refreshTargets([entry(1)], {});
    expect(result.disconnected).toBe(true);
    expect(result.snapshots).toHaveLength(0);
    expect(mocks.getUserProfileById).not.toHaveBeenCalled();
  });

  it("fetches only missing or stale snapshots unless forced", async () => {
    mocks.getUserProfileById.mockImplementation((id: number) => Promise.resolve(profile(id)));
    const result = await refreshTargets([entry(1), entry(2)], { "2": snapshot(2) });
    expect(mocks.getUserProfileById).toHaveBeenCalledTimes(1);
    expect(mocks.getUserProfileById).toHaveBeenCalledWith(1);
    expect(result.snapshots.map((s) => s.tornUserId)).toEqual([1]);
  });

  it("refreshes every entry when forced and derives attackability from the Okay state", async () => {
    mocks.getUserProfileById.mockImplementation((id: number) => Promise.resolve(
      id === 1 ? profile(1) : profile(id, { status: { description: "In hospital", details: null, state: "Hospital", until: 1_700_100_000, color: "red" } }),
    ));
    const stale = snapshot(1, { fetchedAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    const result = await refreshTargets([entry(1), entry(2)], { "1": stale }, { force: true });
    expect(mocks.getUserProfileById).toHaveBeenCalledTimes(2);
    const byId = new Map(result.snapshots.map((s) => [s.tornUserId, s]));
    expect(byId.get(1)!.attackable).toBe(true);
    expect(byId.get(2)!.attackable).toBe(false);
    expect(byId.get(2)!.status.state).toBe("Hospital");
  });

  it("enriches snapshots with the operator's last hit", async () => {
    mocks.getUserProfileById.mockImplementation((id: number) => Promise.resolve(profile(id)));
    mocks.getMyAttacks.mockResolvedValue({ value: { attacks: [
      { id: 9, started: 10, ended: 70, attacker: { id: 999 }, defender: { id: 1 }, result: "Mugged", respect_gain: 5.5, respect_loss: 0, chain: 2 },
    ] } });
    const result = await refreshTargets([entry(1)], {}, { force: true });
    expect(result.snapshots[0]!.lastHit).toEqual({ at: 70, result: "Mugged", respect: 5.5 });
  });

  it("keeps going when a single target fails and records the reason", async () => {
    mocks.getUserProfileById.mockImplementation((id: number) => (
      id === 2 ? Promise.reject(new Error("boom")) : Promise.resolve(profile(id))
    ));
    const result = await refreshTargets([entry(1), entry(2), entry(3)], {}, { force: true });
    expect(result.snapshots.map((s) => s.tornUserId)).toEqual([1, 3]);
    expect(result.errors[2]).toBeTruthy();
  });

  it("tolerates a missing attack log", async () => {
    mocks.getUserProfileById.mockImplementation((id: number) => Promise.resolve(profile(id)));
    mocks.getMyAttacks.mockRejectedValue(new Error("no selection"));
    const result = await refreshTargets([entry(1)], {}, { force: true });
    expect(result.snapshots[0]!.lastHit).toBeNull();
  });
});
