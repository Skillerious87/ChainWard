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
    expect(offlineConnection("member").player).toEqual({ id: 9_000_001, name: "Offline Tester" });
    expect(offlineConnection("owner").player).toEqual({ id: 3_212_954, name: "Skillerious" });
  });

  it("exercises all Torn-backed workspace reads without the network", async () => {
    const connection = offlineConnection("member");
    const client = new TornClient({
      apiKey: connection.apiKey,
      dataMode: "offline",
      fetchImplementation: createOfflineFixtureFetch(connection.apiKey),
      sleep: async () => undefined,
    });

    const [profile, faction, chain, history, members, report] = await Promise.all([
      client.getMyProfile(),
      client.getFactionBasic(),
      client.getCurrentChain(),
      client.getCompletedChains(),
      client.getFactionMembers(),
      client.getChainReport(7_000_003),
    ]);

    expect(profile.profile.id).toBe(connection.player.id);
    expect(faction.basic.id).toBe(connection.faction.id);
    expect(chain.chain.current).toBe(742);
    expect(history.chains).toHaveLength(3);
    expect(members.members.some((member) => member.id === connection.player.id)).toBe(true);
    expect(report.chainreport.faction_id).toBe(connection.faction.id);
  });
});
