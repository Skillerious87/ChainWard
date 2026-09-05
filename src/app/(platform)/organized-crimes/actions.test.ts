import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFactionPermission: vi.fn(),
  getOwnOcIntelDraft: vi.fn(),
  saveMemberIntel: vi.fn(),
  deleteMemberIntel: vi.fn(),
  readMemberIntel: vi.fn(),
  writeOcReviewSettings: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/faction-authorization", () => ({ requireFactionPermission: mocks.requireFactionPermission }));
vi.mock("@/lib/organized-crimes/data-service", () => ({ getOwnOcIntelDraft: mocks.getOwnOcIntelDraft }));
vi.mock("@/lib/organized-crimes/store", () => ({
  saveMemberIntel: mocks.saveMemberIntel,
  deleteMemberIntel: mocks.deleteMemberIntel,
  readMemberIntel: mocks.readMemberIntel,
  writeOcReviewSettings: mocks.writeOcReviewSettings,
}));

import {
  removeMemberOcIntelAction,
  setOcReviewSettingsAction,
  shareOwnOcIntelAction,
  withdrawOwnOcIntelAction,
} from "./actions";

const AUTH = { actor: { tornUserId: 555, name: "Me" }, faction: { id: 42, name: "Faction", tag: "F" }, role: "OWNER" as const };

const DRAFT = {
  ok: true as const,
  draft: {
    stats: { strength: 1, defense: 1, speed: 1, dexterity: 1, total: 4 },
    statsAt: "2026-09-05T00:00:00.000Z",
    roles: [],
    rolesMessage: "none",
    source: "torn" as const,
  },
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireFactionPermission.mockResolvedValue(AUTH);
});

describe("shareOwnOcIntelAction", () => {
  it("stores the caller's own draft under faction:view", async () => {
    mocks.getOwnOcIntelDraft.mockResolvedValue(DRAFT);

    const result = await shareOwnOcIntelAction();

    expect(mocks.requireFactionPermission).toHaveBeenCalledWith("faction:view");
    expect(mocks.saveMemberIntel).toHaveBeenCalledWith(AUTH.faction, expect.objectContaining({ factionId: 42, tornUserId: 555 }));
    expect(result.ok).toBe(true);
  });

  it("surfaces a draft failure without storing anything", async () => {
    mocks.getOwnOcIntelDraft.mockResolvedValue({ ok: false, message: "Your Torn API key does not grant battle-stat access." });

    const result = await shareOwnOcIntelAction();

    expect(result).toEqual({ ok: false, message: "Your Torn API key does not grant battle-stat access." });
    expect(mocks.saveMemberIntel).not.toHaveBeenCalled();
  });

  it("reports the authorization error when permission is refused", async () => {
    mocks.requireFactionPermission.mockRejectedValue(new Error("You do not have active application access for this faction."));

    const result = await shareOwnOcIntelAction();

    expect(result).toEqual({ ok: false, message: "You do not have active application access for this faction." });
  });
});

describe("withdrawOwnOcIntelAction", () => {
  it("removes only the caller's own record", async () => {
    const result = await withdrawOwnOcIntelAction();

    expect(mocks.requireFactionPermission).toHaveBeenCalledWith("faction:view");
    expect(mocks.deleteMemberIntel).toHaveBeenCalledWith(42, 555);
    expect(result.ok).toBe(true);
  });
});

describe("removeMemberOcIntelAction", () => {
  it("requires oc:review and deletes an existing shared record", async () => {
    mocks.readMemberIntel.mockResolvedValue([{ tornUserId: 900 }]);

    const result = await removeMemberOcIntelAction({ tornUserId: 900 });

    expect(mocks.requireFactionPermission).toHaveBeenCalledWith("oc:review");
    expect(mocks.deleteMemberIntel).toHaveBeenCalledWith(42, 900);
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid target", async () => {
    const result = await removeMemberOcIntelAction({ tornUserId: 0 });
    expect(result.ok).toBe(false);
    expect(mocks.deleteMemberIntel).not.toHaveBeenCalled();
  });

  it("does nothing when the member has shared nothing", async () => {
    mocks.readMemberIntel.mockResolvedValue([]);
    const result = await removeMemberOcIntelAction({ tornUserId: 900 });
    expect(result.ok).toBe(false);
    expect(mocks.deleteMemberIntel).not.toHaveBeenCalled();
  });
});

describe("setOcReviewSettingsAction", () => {
  it("requires oc:review and persists a valid threshold", async () => {
    const result = await setOcReviewSettingsAction({ minimumCpr: 80 });

    expect(mocks.requireFactionPermission).toHaveBeenCalledWith("oc:review");
    expect(mocks.writeOcReviewSettings).toHaveBeenCalledWith(AUTH.faction, { minimumCpr: 80 });
    expect(result.ok).toBe(true);
  });

  it("rejects an out-of-range threshold", async () => {
    const result = await setOcReviewSettingsAction({ minimumCpr: 150 });
    expect(result.ok).toBe(false);
    expect(mocks.writeOcReviewSettings).not.toHaveBeenCalled();
  });
});
