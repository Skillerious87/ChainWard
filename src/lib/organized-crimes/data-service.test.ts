import { beforeEach, describe, expect, it, vi } from "vitest";
import { TornApiError } from "@/lib/torn/errors";

const { getConfiguredTornConnection } = vi.hoisted(() => ({ getConfiguredTornConnection: vi.fn() }));
vi.mock("@/lib/torn/server-client", () => ({ getConfiguredTornConnection }));

import { getCrimeFeed, getOwnOcIntelDraft } from "./data-service";

const NOW_S = Math.floor(Date.parse("2026-09-05T12:00:00.000Z") / 1_000);

function validCrime(id: number, userId: number) {
  return {
    id,
    name: "Stage Robbery",
    difficulty: 7,
    status: "Recruiting",
    created_at: NOW_S - 3_600,
    expired_at: NOW_S + 86_400,
    executed_at: null,
    ready_at: null,
    slots: [
      { position: "Robber", position_info: { id: "1", label: "Robber #1" }, user: null, checkpoint_pass_rate: 84, item_requirement: null },
      { position: "Lookout", position_info: { id: "2", label: "Lookout" }, user: { id: userId, joined_at: NOW_S - 1_800 }, checkpoint_pass_rate: null, item_requirement: null },
    ],
  };
}

function battleStatsResponse() {
  return {
    value: {
      battlestats: {
        strength: { value: 100 }, defense: { value: 200 },
        speed: { value: 300 }, dexterity: { value: 400 }, total: 1_000,
      },
    },
    fetchedAt: Date.parse("2026-09-05T12:00:00.000Z"),
  };
}

function connectionWith(client: Record<string, unknown>) {
  return { client: { dataMode: "torn", ...client }, tornUserId: 555, factionId: 42 };
}

beforeEach(() => {
  getConfiguredTornConnection.mockReset();
});

describe("getCrimeFeed", () => {
  it("returns an available, complete feed for a single page", async () => {
    const getOrganizedCrimes = vi.fn().mockResolvedValue({
      value: { crimes: [validCrime(1, 555), validCrime(2, 555)], _metadata: { links: { next: null } } },
      fetchedAt: Date.parse("2026-09-05T12:00:00.000Z"),
    });
    getConfiguredTornConnection.mockResolvedValue(connectionWith({ getOrganizedCrimes }));

    const feed = await getCrimeFeed("available");

    expect(feed.available).toBe(true);
    expect(feed.complete).toBe(true);
    expect(feed.crimes).toHaveLength(2);
    expect(getOrganizedCrimes).toHaveBeenCalledOnce();
  });

  it("drops an unparseable crime row instead of failing the whole feed", async () => {
    const getOrganizedCrimes = vi.fn().mockResolvedValue({
      value: { crimes: [validCrime(1, 555), { id: -1, nonsense: true }], _metadata: { links: { next: null } } },
      fetchedAt: Date.now(),
    });
    getConfiguredTornConnection.mockResolvedValue(connectionWith({ getOrganizedCrimes }));

    const feed = await getCrimeFeed("available");

    expect(feed.available).toBe(true);
    expect(feed.crimes).toHaveLength(1);
    expect(feed.message).toMatch(/skipped/i);
  });

  it("stops following pagination at the page cap and reports the feed as incomplete", async () => {
    const page = { value: { crimes: Array.from({ length: 100 }, (_, index) => validCrime(index + 1, 555)), _metadata: { links: { next: "https://api.torn.com/v2/faction/crimes?offset=next" } } }, fetchedAt: Date.now() };
    const getOrganizedCrimes = vi.fn().mockResolvedValue(page);
    getConfiguredTornConnection.mockResolvedValue(connectionWith({ getOrganizedCrimes }));

    const feed = await getCrimeFeed("completed");

    expect(getOrganizedCrimes).toHaveBeenCalledTimes(20);
    expect(feed.complete).toBe(false);
    expect(feed.crimes).toHaveLength(2_000);
  });

  it("returns an unavailable feed when Torn rejects the request", async () => {
    const getOrganizedCrimes = vi.fn().mockRejectedValue(new TornApiError(17, "Torn API is down."));
    getConfiguredTornConnection.mockResolvedValue(connectionWith({ getOrganizedCrimes }));

    const feed = await getCrimeFeed("available");

    expect(feed.available).toBe(false);
    expect(feed.crimes).toEqual([]);
  });

  it("returns an unavailable feed when there is no connection", async () => {
    getConfiguredTornConnection.mockResolvedValue(null);
    const feed = await getCrimeFeed("available");
    expect(feed.available).toBe(false);
  });
});

describe("getOwnOcIntelDraft", () => {
  it("builds a draft from the caller's own stats and live open-slot pass rates", async () => {
    const getMyOrganizedCrimes = vi.fn().mockResolvedValue({
      value: { organizedcrimes: [validCrime(1, 555)] },
      fetchedAt: Date.parse("2026-09-05T12:00:00.000Z"),
    });
    getConfiguredTornConnection.mockResolvedValue(connectionWith({
      getMyOrganizedCrimes,
      getMyBattleStats: vi.fn().mockResolvedValue(battleStatsResponse()),
    }));

    const result = await getOwnOcIntelDraft();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.stats).toEqual({ strength: 100, defense: 200, speed: 300, dexterity: 400, total: 1_000 });
    expect(result.draft.roles).toHaveLength(1);
    expect(result.draft.roles[0]).toMatchObject({ positionLabel: "Robber #1", passRate: 84 });
    expect(getMyOrganizedCrimes).toHaveBeenCalledOnce();
  });

  it("explains when the caller's key lacks battle-stat access", async () => {
    getConfiguredTornConnection.mockResolvedValue(connectionWith({
      getMyBattleStats: vi.fn().mockRejectedValue(new TornApiError(16, "Insufficient permission.")),
    }));

    const result = await getOwnOcIntelDraft();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/battle-stat access/i);
  });

  it("still shares stats when the live OC feed is unavailable", async () => {
    getConfiguredTornConnection.mockResolvedValue(connectionWith({
      getMyOrganizedCrimes: vi.fn().mockRejectedValue(new TornApiError(17, "Torn API is down.")),
      getMyBattleStats: vi.fn().mockResolvedValue(battleStatsResponse()),
    }));

    const result = await getOwnOcIntelDraft();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.roles).toEqual([]);
    expect(result.draft.rolesMessage).toMatch(/could not be read/i);
  });

  it("notes when the caller's key lacks the organized-crimes selection", async () => {
    getConfiguredTornConnection.mockResolvedValue(connectionWith({
      getMyOrganizedCrimes: vi.fn().mockRejectedValue(new TornApiError(16, "Insufficient permission.")),
      getMyBattleStats: vi.fn().mockResolvedValue(battleStatsResponse()),
    }));

    const result = await getOwnOcIntelDraft();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.roles).toEqual([]);
    expect(result.draft.rolesMessage).toMatch(/organized-crimes selection/i);
  });
});
