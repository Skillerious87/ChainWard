import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFactionPermission: vi.fn(),
  getConfiguredTornConnection: vi.fn(),
  targetsStorageAvailable: vi.fn(),
  readTargetList: vi.fn(),
  writeTargetList: vi.fn(),
  fetchTargetSnapshot: vi.fn(),
  refreshTargets: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/faction-authorization", () => ({ requireFactionPermission: mocks.requireFactionPermission }));
vi.mock("@/lib/torn/server-client", () => ({ getConfiguredTornConnection: mocks.getConfiguredTornConnection }));
vi.mock("@/lib/targets/data-service", () => ({
  fetchTargetSnapshot: mocks.fetchTargetSnapshot,
  refreshTargets: mocks.refreshTargets,
}));
vi.mock("@/lib/targets/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/targets/store")>("@/lib/targets/store");
  return {
    ...actual,
    targetsStorageAvailable: mocks.targetsStorageAvailable,
    readTargetList: mocks.readTargetList,
    writeTargetList: mocks.writeTargetList,
  };
});

import { addTargetAction, refreshTargetsAction, removeTargetAction, updateTargetNoteAction } from "./actions";

const AUTH = { actor: { tornUserId: 555, name: "Me" }, faction: { id: 42, name: "Faction", tag: "F" }, role: "OWNER" as const };
const CLIENT = { dataMode: "torn" as const };

function snapshot(tornUserId: number, name = `Target ${tornUserId}`) {
  return {
    tornUserId, name, level: 20, factionId: null, factionName: "", position: "",
    status: { description: "Okay", state: "Okay", until: null, color: "green" },
    lastActionAt: 1_700_000_000, lastActionRelative: "1 hour ago", lifeCurrent: 1, lifeMaximum: 1,
    attackable: true, fetchedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireFactionPermission.mockResolvedValue(AUTH);
  mocks.getConfiguredTornConnection.mockResolvedValue({ factionId: 42, factionName: "Faction", factionTag: "F", client: CLIENT });
  mocks.targetsStorageAvailable.mockReturnValue(true);
  mocks.readTargetList.mockResolvedValue({ entries: [], snapshots: {} });
  mocks.writeTargetList.mockResolvedValue(undefined);
});

describe("addTargetAction", () => {
  it("adds a target parsed from a profile URL and persists its first snapshot", async () => {
    mocks.fetchTargetSnapshot.mockResolvedValue(snapshot(900, "Rival"));

    const result = await addTargetAction({ reference: "https://www.torn.com/profiles.php?XID=900", note: "war target" });

    expect(result.ok).toBe(true);
    expect(mocks.fetchTargetSnapshot).toHaveBeenCalledWith(CLIENT, 900);
    const [, , written] = mocks.writeTargetList.mock.calls[0]!;
    expect(written.entries).toEqual([expect.objectContaining({ tornUserId: 900, note: "war target" })]);
    expect(written.snapshots["900"].name).toBe("Rival");
  });

  it("adds a target given a bare numeric ID", async () => {
    mocks.fetchTargetSnapshot.mockResolvedValue(snapshot(1234567));
    const result = await addTargetAction({ reference: "1234567" });
    expect(result.ok).toBe(true);
    expect(mocks.fetchTargetSnapshot).toHaveBeenCalledWith(CLIENT, 1234567);
  });

  it("rejects an unparseable reference before touching Torn", async () => {
    const result = await addTargetAction({ reference: "not-a-player" });
    expect(result.ok).toBe(false);
    expect(mocks.fetchTargetSnapshot).not.toHaveBeenCalled();
  });

  it("refuses to add the operator themselves", async () => {
    const result = await addTargetAction({ reference: "555" });
    expect(result).toEqual({ ok: false, message: "You cannot add yourself as a target." });
  });

  it("rejects a duplicate that is already on the list", async () => {
    mocks.readTargetList.mockResolvedValue({ entries: [{ tornUserId: 900, label: "Rival", note: "", addedAt: new Date().toISOString() }], snapshots: {} });
    mocks.fetchTargetSnapshot.mockResolvedValue(snapshot(900));
    const result = await addTargetAction({ reference: "900" });
    expect(result.ok).toBe(false);
    expect(mocks.writeTargetList).not.toHaveBeenCalled();
  });

  it("surfaces missing workspace storage", async () => {
    mocks.targetsStorageAvailable.mockReturnValue(false);
    const result = await addTargetAction({ reference: "900" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/storage/i);
  });
});

describe("removeTargetAction", () => {
  it("removes a target that is on the list", async () => {
    mocks.readTargetList.mockResolvedValue({ entries: [{ tornUserId: 900, label: "R", note: "", addedAt: new Date().toISOString() }], snapshots: {} });
    const result = await removeTargetAction({ tornUserId: 900 });
    expect(result.ok).toBe(true);
    expect(mocks.writeTargetList).toHaveBeenCalled();
  });

  it("rejects an invalid target id", async () => {
    const result = await removeTargetAction({ tornUserId: 0 });
    expect(result.ok).toBe(false);
    expect(mocks.writeTargetList).not.toHaveBeenCalled();
  });

  it("does nothing when the target is not on the list", async () => {
    const result = await removeTargetAction({ tornUserId: 900 });
    expect(result.ok).toBe(false);
    expect(mocks.writeTargetList).not.toHaveBeenCalled();
  });
});

describe("updateTargetNoteAction", () => {
  it("saves a note for an existing target", async () => {
    mocks.readTargetList.mockResolvedValue({ entries: [{ tornUserId: 900, label: "R", note: "", addedAt: new Date().toISOString() }], snapshots: {} });
    const result = await updateTargetNoteAction({ tornUserId: 900, note: "Hits back hard" });
    expect(result.ok).toBe(true);
    const [, , written] = mocks.writeTargetList.mock.calls[0]!;
    expect(written.entries[0].note).toBe("Hits back hard");
  });

  it("rejects an over-long note", async () => {
    const result = await updateTargetNoteAction({ tornUserId: 900, note: "x".repeat(281) });
    expect(result.ok).toBe(false);
  });
});

describe("refreshTargetsAction", () => {
  it("force-refreshes and persists the returned snapshots", async () => {
    mocks.readTargetList.mockResolvedValue({ entries: [{ tornUserId: 900, label: "R", note: "", addedAt: new Date().toISOString() }], snapshots: {} });
    mocks.refreshTargets.mockResolvedValue({ snapshots: [snapshot(900)], errors: {}, fetchedAt: new Date().toISOString(), source: "Torn API v2", disconnected: false });

    const result = await refreshTargetsAction();

    expect(mocks.refreshTargets).toHaveBeenCalledWith(expect.any(Array), expect.any(Object), { force: true });
    expect(mocks.writeTargetList).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("reports partial failure without claiming success", async () => {
    mocks.readTargetList.mockResolvedValue({ entries: [{ tornUserId: 900, label: "R", note: "", addedAt: new Date().toISOString() }], snapshots: {} });
    mocks.refreshTargets.mockResolvedValue({ snapshots: [], errors: { 900: "boom" }, fetchedAt: new Date().toISOString(), source: "Torn API v2", disconnected: false });

    const result = await refreshTargetsAction();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/could not be read/);
  });

  it("no-ops on an empty list", async () => {
    const result = await refreshTargetsAction();
    expect(result).toEqual({ ok: true, message: "Your target list is empty." });
    expect(mocks.refreshTargets).not.toHaveBeenCalled();
  });
});
