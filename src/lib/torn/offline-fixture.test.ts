import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crimeSchema } from "@/lib/organized-crimes/types";
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

    const [profile, profileDetails, faction, chain, history, members, report, battleStats, activeCrimes, completedCrimes] = await Promise.all([
      client.getMyProfile(),
      client.getMyProfileDetails(),
      client.getFactionBasic(),
      client.getCurrentChain(),
      client.getCompletedChains(),
      client.getFactionMembers(),
      client.getChainReport(7_000_003),
      client.getMyBattleStats(),
      client.getOrganizedCrimes("available"),
      client.getOrganizedCrimes("completed"),
    ]);

    expect(profile.profile.id).toBe(connection.player.id);
    expect(profileDetails.profile.image).toBeNull();
    expect(faction.basic.id).toBe(connection.faction.id);
    expect(chain.chain.current).toBe(742);
    expect(history.chains).toHaveLength(3);
    expect(members.members.some((member) => member.id === connection.player.id)).toBe(true);
    expect(report.chainreport.faction_id).toBe(connection.faction.id);
    expect(Number(battleStats.value.battlestats.total)).toBeGreaterThan(0);
    const parsedActive = activeCrimes.value.crimes.map((crime) => crimeSchema.parse(crime));
    const parsedCompleted = completedCrimes.value.crimes.map((crime) => crimeSchema.parse(crime));
    expect(parsedActive.every((crime) => crime.status === "Recruiting" || crime.status === "Planning")).toBe(true);
    expect(parsedActive.some((crime) => crime.slots.some((slot) => slot.user === null && slot.checkpoint_pass_rate !== null))).toBe(true);
    expect(parsedCompleted.every((crime) => crime.status === "Successful" || crime.status === "Failure")).toBe(true);
    expect(await client.getOrganizedCrimes("available", 100).then((page) => page.value.crimes)).toHaveLength(0);
  });
});
