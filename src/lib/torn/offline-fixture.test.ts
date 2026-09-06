import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TornClient } from "./client";
import { createOfflineFixtureFetch, offlineConnection, offlineTestModeEnabled } from "./offline-fixture";

describe("offline Torn fixture", () => {
  const previous = process.env.CHAINWARD_OFFLINE_TEST_MODE;

  beforeEach(() => { process.env.CHAINWARD_OFFLINE_TEST_MODE = "true"; });
  afterEach(() => {
    if (previous === undefined) delete process.env.CHAINWARD_OFFLINE_TEST_MODE;
    else process.env.CHAINWARD_OFFLINE_TEST_MODE = previous;
  });

  it("creates deterministic member and owner identities only when explicitly enabled", () => {
    expect(offlineTestModeEnabled()).toBe(true);
    expect(offlineConnection("member").player).toEqual({ id: 9_000_001, name: "Offline Tester", imageUrl: null });
    expect(offlineConnection("owner").player).toEqual({ id: 3_212_954, name: "Skillerious", imageUrl: null });
  });

  it("exercises all Torn-backed workspace reads without the network", async () => {
    const connection = offlineConnection("member");
    const client = new TornClient({
      apiKey: connection.apiKey,
      dataMode: "offline",
      fetchImplementation: createOfflineFixtureFetch(connection.apiKey),
      sleep: async () => undefined,
    });

    const [profile, profileDetails, faction, chain, history, members, report, battleStats, target] = await Promise.all([
      client.getMyProfile(),
      client.getMyProfileDetails(),
      client.getFactionBasic(),
      client.getCurrentChain(),
      client.getCompletedChains(),
      client.getFactionMembers(),
      client.getChainReport(7_000_003),
      client.getMyBattleStats(),
      client.getUserProfileById(2_000_015),
    ]);

    expect(profile.profile.id).toBe(connection.player.id);
    expect(profileDetails.profile.image).toBeNull();
    expect(faction.basic.id).toBe(connection.faction.id);
    expect(chain.chain.current).toBe(742);
    expect(history.chains).toHaveLength(3);
    expect(members.members.some((member) => member.id === connection.player.id)).toBe(true);
    expect(report.chainreport.faction_id).toBe(connection.faction.id);
    expect(Number(battleStats.value.battlestats.total)).toBeGreaterThan(0);

    expect(target.value.profile.id).toBe(2_000_015);
    expect(target.value.profile.level).toBeGreaterThan(0);
    expect(typeof target.value.profile.status.state).toBe("string");
    expect(target.value.profile.life.maximum).toBeGreaterThan(0);
  });

  it("returns varied target states across ids so the watchlist has something to show", async () => {
    const connection = offlineConnection("member");
    const client = new TornClient({
      apiKey: connection.apiKey,
      dataMode: "offline",
      fetchImplementation: createOfflineFixtureFetch(connection.apiKey),
      sleep: async () => undefined,
    });

    const states = await Promise.all(
      [2_000_010, 2_000_011, 2_000_012, 2_000_013].map((id) => client.getUserProfileById(id).then((res) => res.value.profile.status.state)),
    );
    expect(new Set(states).size).toBeGreaterThan(1);
  });
});
