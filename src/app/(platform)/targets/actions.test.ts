import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFactionPermission: vi.fn(),
  getConfiguredTornConnection: vi.fn(),
  targetsStorageAvailable: vi.fn(),
  readTargetList: vi.fn(),
  writeTargetList: vi.fn(),
  fetchTargetSnapshot: vi.fn(),
  fetchTargetSnapshots: vi.fn(),
  loadHitIndex: vi.fn(),
  snapshotFromFactionMember: vi.fn(),
  placeholderSnapshot: vi.fn(),
  refreshTargets: vi.fn(),
  saveFfscouterKey: vi.fn(),
  clearFfscouterKey: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/faction-authorization", () => ({ requireFactionPermission: mocks.requireFactionPermission }));
vi.mock("@/lib/torn/server-client", () => ({ getConfiguredTornConnection: mocks.getConfiguredTornConnection }));
vi.mock("@/lib/targets/data-service", () => ({
  fetchTargetSnapshot: mocks.fetchTargetSnapshot,
  fetchTargetSnapshots: mocks.fetchTargetSnapshots,
  loadHitIndex: mocks.loadHitIndex,
  snapshotFromFactionMember: mocks.snapshotFromFactionMember,
  placeholderSnapshot: mocks.placeholderSnapshot,
  refreshTargets: mocks.refreshTargets,
}));
vi.mock("@/lib/targets/ffscouter-key-store", () => ({
  saveFfscouterKey: mocks.saveFfscouterKey,
  clearFfscouterKey: mocks.clearFfscouterKey,
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

import {
  addTargetAction,
  importFactionTargetsAction,
  importTargetsAction,
  refreshTargetsAction,
  removeTargetAction,
  removeFfscouterKeyAction,
  saveFfscouterKeyAction,
  setTargetPinnedAction,
  setTargetTagsAction,
  updateTargetNoteAction,
} from "./actions";

const AUTH = { actor: { tornUserId: 555, name: "Me" }, faction: { id: 42, name: "Faction", tag: "F" }, role: "OWNER" as const };
const CLIENT = {
  dataMode: "torn" as const,
  getFactionBasic: vi.fn(),
  getFactionMembers: vi.fn(),
};

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
  CLIENT.getFactionBasic.mockReset();
  CLIENT.getFactionMembers.mockReset();
  mocks.requireFactionPermission.mockResolvedValue(AUTH);
  mocks.getConfiguredTornConnection.mockResolvedValue({ factionId: 42, factionName: "Faction", factionTag: "F", client: CLIENT });
  mocks.targetsStorageAvailable.mockReturnValue(true);
  mocks.readTargetList.mockResolvedValue({ entries: [], snapshots: {} });
  mocks.writeTargetList.mockResolvedValue(undefined);
  mocks.loadHitIndex.mockResolvedValue(new Map());
  mocks.placeholderSnapshot.mockImplementation((tornUserId: number) => snapshot(tornUserId, ""));
});

describe("addTargetAction", () => {
  it("adds a target parsed from a profile URL and persists its first snapshot", async () => {
    mocks.fetchTargetSnapshot.mockResolvedValue(snapshot(900, "Rival"));

    const result = await addTargetAction({ reference: "https://www.torn.com/profiles.php?XID=900", note: "war target" });

    expect(result.ok).toBe(true);
    expect(mocks.fetchTargetSnapshot).toHaveBeenCalledWith(CLIENT, 900, undefined);
    const [, , written] = mocks.writeTargetList.mock.calls[0]!;
    expect(written.entries).toEqual([expect.objectContaining({ tornUserId: 900, note: "war target" })]);
    expect(written.snapshots["900"].name).toBe("Rival");
  });

  it("adds a target given a bare numeric ID", async () => {
    mocks.fetchTargetSnapshot.mockResolvedValue(snapshot(1234567));
    const result = await addTargetAction({ reference: "1234567" });
    expect(result.ok).toBe(true);
    expect(mocks.fetchTargetSnapshot).toHaveBeenCalledWith(CLIENT, 1234567, undefined);
  });

  it("passes the operator's existing hit history on this target through to the snapshot", async () => {
    const hit = { lastHit: { at: 100, result: "Mugged", respect: 5 }, hitYouBack: false };
    mocks.loadHitIndex.mockResolvedValue(new Map([[900, hit]]));
    mocks.fetchTargetSnapshot.mockResolvedValue(snapshot(900, "Rival"));
    await addTargetAction({ reference: "900" });
    expect(mocks.fetchTargetSnapshot).toHaveBeenCalledWith(CLIENT, 900, hit);
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
    mocks.refreshTargets.mockResolvedValue({ snapshots: [snapshot(900)], errors: {}, fetchedAt: new Date().toISOString(), source: "Torn API v2", disconnected: false, dueTotal: 1 });

    const result = await refreshTargetsAction();

    expect(mocks.refreshTargets).toHaveBeenCalledWith(expect.any(Array), expect.any(Object), { force: true, budget: 60 });
    expect(mocks.writeTargetList).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("reports partial failure without claiming success", async () => {
    mocks.readTargetList.mockResolvedValue({ entries: [{ tornUserId: 900, label: "R", note: "", addedAt: new Date().toISOString() }], snapshots: {} });
    mocks.refreshTargets.mockResolvedValue({ snapshots: [], errors: { 900: "boom" }, fetchedAt: new Date().toISOString(), source: "Torn API v2", disconnected: false, dueTotal: 1 });

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

function entry(tornUserId: number) {
  return { tornUserId, label: `T${tornUserId}`, note: "", pinned: false, tags: [], addedAt: new Date().toISOString() };
}

describe("setTargetPinnedAction", () => {
  it("pins an existing target", async () => {
    mocks.readTargetList.mockResolvedValue({ entries: [entry(900)], snapshots: {} });
    const result = await setTargetPinnedAction({ tornUserId: 900, pinned: true });
    expect(result.ok).toBe(true);
    const [, , written] = mocks.writeTargetList.mock.calls[0]!;
    expect(written.entries[0].pinned).toBe(true);
  });

  it("rejects a target that is not on the list", async () => {
    const result = await setTargetPinnedAction({ tornUserId: 900, pinned: true });
    expect(result.ok).toBe(false);
    expect(mocks.writeTargetList).not.toHaveBeenCalled();
  });
});

describe("setTargetTagsAction", () => {
  it("normalises, de-duplicates and caps tags", async () => {
    mocks.readTargetList.mockResolvedValue({ entries: [entry(900)], snapshots: {} });
    const result = await setTargetTagsAction({ tornUserId: 900, tags: ["War ", "war", "Farm!!", "watch", "b", "c"] });
    expect(result.ok).toBe(true);
    const [, , written] = mocks.writeTargetList.mock.calls[0]!;
    expect(written.entries[0].tags).toEqual(["war", "farm", "watch", "b", "c"]);
  });
});

describe("importTargetsAction", () => {
  it("adds every parseable id as a placeholder with no Torn calls, skipping self and duplicates", async () => {
    mocks.readTargetList.mockResolvedValue({ entries: [entry(111)], snapshots: {} });

    const result = await importTargetsAction({ text: "111\n222\nhttps://www.torn.com/profiles.php?XID=333\n555\nnot-an-id" });

    expect(result.ok).toBe(true);
    expect(result.added).toBe(2);
    expect(mocks.fetchTargetSnapshots).not.toHaveBeenCalled();
    expect(mocks.loadHitIndex).not.toHaveBeenCalled();
    const [, , written] = mocks.writeTargetList.mock.calls[0]!;
    expect(written.entries.map((e: { tornUserId: number }) => e.tornUserId).sort()).toEqual([111, 222, 333]);
    // 222 and 333 are stored with a placeholder snapshot each
    expect(Object.keys(written.snapshots).sort()).toEqual(["222", "333"]);
  });

  it("rejects a blob with no ids", async () => {
    const result = await importTargetsAction({ text: "nothing useful here" });
    expect(result.ok).toBe(false);
    expect(mocks.writeTargetList).not.toHaveBeenCalled();
  });
});

describe("importFactionTargetsAction", () => {
  function member(id: number, name: string) {
    return {
      id, name, position: "Member", level: 30, days_in_faction: 10,
      is_revivable: true, is_on_wall: false, is_in_oc: false, has_early_discharge: false,
      last_action: { status: "Offline", timestamp: 1_700_000_000, relative: "1 hour ago" },
      status: { description: "Okay", details: null, state: "Okay", until: null, color: "green" },
      revive_setting: "Everyone",
    };
  }

  it("imports every member of another faction in one action", async () => {
    mocks.readTargetList.mockResolvedValue({ entries: [], snapshots: {} });
    CLIENT.getFactionBasic.mockResolvedValue({ basic: { id: 77, name: "Rival Faction" } });
    CLIENT.getFactionMembers.mockResolvedValue({ members: [member(900, "Rival One"), member(901, "Rival Two")] });
    mocks.snapshotFromFactionMember.mockImplementation((_factionId: number, _factionName: string, roster: { id: number }) => snapshot(roster.id));

    const result = await importFactionTargetsAction({ factionId: 77 });

    expect(result.ok).toBe(true);
    expect(CLIENT.getFactionBasic).toHaveBeenCalledWith(77);
    expect(CLIENT.getFactionMembers).toHaveBeenCalledWith(77);
    const [, , written] = mocks.writeTargetList.mock.calls[0]!;
    expect(written.entries.map((e: { tornUserId: number }) => e.tornUserId).sort()).toEqual([900, 901]);
  });

  it("refuses to import the operator's own faction", async () => {
    const result = await importFactionTargetsAction({ factionId: 42 });
    expect(result.ok).toBe(false);
    expect(CLIENT.getFactionMembers).not.toHaveBeenCalled();
  });
});

describe("saveFfscouterKeyAction", () => {
  it("saves a valid-looking key", async () => {
    mocks.saveFfscouterKey.mockResolvedValue("abcd");
    const result = await saveFfscouterKeyAction({ apiKey: "abcdef0123456789" });
    expect(result.ok).toBe(true);
    expect(mocks.saveFfscouterKey).toHaveBeenCalledWith(AUTH.faction, AUTH.actor.tornUserId, "abcdef0123456789");
  });

  it("rejects an empty key before touching storage", async () => {
    const result = await saveFfscouterKeyAction({ apiKey: "" });
    expect(result.ok).toBe(false);
    expect(mocks.saveFfscouterKey).not.toHaveBeenCalled();
  });
});

describe("removeFfscouterKeyAction", () => {
  it("clears the stored key", async () => {
    const result = await removeFfscouterKeyAction();
    expect(result.ok).toBe(true);
    expect(mocks.clearFfscouterKey).toHaveBeenCalledWith(AUTH.faction, AUTH.actor.tornUserId);
  });
});
