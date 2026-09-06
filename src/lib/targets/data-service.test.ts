import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfiguredTornConnection: vi.fn(),
  getUserProfileById: vi.fn(),
}));

vi.mock("@/lib/torn/server-client", () => ({ getConfiguredTornConnection: mocks.getConfiguredTornConnection }));

import { refreshTargets } from "./data-service";
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
  return { tornUserId, label: `Target ${tornUserId}`, note: "", addedAt: new Date().toISOString() };
}

beforeEach(() => {
  mocks.getConfiguredTornConnection.mockReset();
  mocks.getUserProfileById.mockReset();
  mocks.getConfiguredTornConnection.mockResolvedValue({
    client: { dataMode: "torn", getUserProfileById: mocks.getUserProfileById },
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
    const fresh: TargetSnapshot = {
      tornUserId: 2, name: "Fresh", level: 10, factionId: null, factionName: "", position: "",
      status: { description: "Okay", state: "Okay", until: null, color: "green" },
      lastActionAt: 0, lastActionRelative: "", lifeCurrent: 0, lifeMaximum: 0, attackable: true,
      fetchedAt: new Date().toISOString(),
    };

    const result = await refreshTargets([entry(1), entry(2)], { "2": fresh });
    expect(mocks.getUserProfileById).toHaveBeenCalledTimes(1);
    expect(mocks.getUserProfileById).toHaveBeenCalledWith(1);
    expect(result.snapshots.map((snapshot) => snapshot.tornUserId)).toEqual([1]);
  });

  it("refreshes every entry when forced and derives attackability from the Okay state", async () => {
    mocks.getUserProfileById.mockImplementation((id: number) => Promise.resolve(
      id === 1 ? profile(1) : profile(id, { status: { description: "In hospital", details: null, state: "Hospital", until: 1_700_100_000, color: "red" } }),
    ));

    const stale: TargetSnapshot = {
      tornUserId: 1, name: "Old", level: 1, factionId: null, factionName: "", position: "",
      status: { description: "Okay", state: "Okay", until: null, color: "green" },
      lastActionAt: 0, lastActionRelative: "", lifeCurrent: 0, lifeMaximum: 0, attackable: true,
      fetchedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    };

    const result = await refreshTargets([entry(1), entry(2)], { "1": stale }, { force: true });
    expect(mocks.getUserProfileById).toHaveBeenCalledTimes(2);
    const byId = new Map(result.snapshots.map((snapshot) => [snapshot.tornUserId, snapshot]));
    expect(byId.get(1)!.attackable).toBe(true);
    expect(byId.get(2)!.attackable).toBe(false);
    expect(byId.get(2)!.status.state).toBe("Hospital");
  });

  it("keeps going when a single target fails and records the reason", async () => {
    mocks.getUserProfileById.mockImplementation((id: number) => (
      id === 2 ? Promise.reject(new Error("boom")) : Promise.resolve(profile(id))
    ));

    const result = await refreshTargets([entry(1), entry(2), entry(3)], {}, { force: true });
    expect(result.snapshots.map((snapshot) => snapshot.tornUserId)).toEqual([1, 3]);
    expect(result.errors[2]).toBeTruthy();
  });
});
