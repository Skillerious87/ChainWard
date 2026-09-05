import "server-only";

import type { ValidatedTornConnection } from "./connection-service";

export type OfflineIdentity = "member" | "guest" | "departed" | "owner";

export const OFFLINE_FACTION = {
  id: 98_765,
  name: "Chainward Test Faction",
  tag: "CWTEST",
} as const;

const OFFLINE_IDENTITIES = {
  member: { id: 9_000_001, name: "Offline Tester", apiKey: "chainward-offline-member" },
  guest: { id: 9_000_002, name: "Nova Chain", apiKey: "chainward-offline-guest" },
  departed: { id: 9_000_099, name: "Former Member", apiKey: "chainward-offline-departed" },
  owner: { id: 3_212_954, name: "Skillerious", apiKey: "chainward-offline-owner" },
} as const;

export function offlineTestModeEnabled(): boolean {
  const value = process.env.CHAINWARD_OFFLINE_TEST_MODE?.trim().toLowerCase();
  return process.env.NODE_ENV !== "production" && (value === "true" || value === "1");
}

export function offlineConnection(identity: OfflineIdentity): ValidatedTornConnection & { apiKey: string } {
  if (!offlineTestModeEnabled()) throw new Error("Offline test mode is not enabled.");
  const actor = OFFLINE_IDENTITIES[identity];
  return {
    apiKey: actor.apiKey,
    player: { id: actor.id, name: actor.name, imageUrl: null },
    faction: OFFLINE_FACTION,
    key: {
      accessType: "Offline test fixture",
      hasFactionPermission: true,
      selections: ["basic", "chain", "chains", "chainreport", "members", "crimes", "battlestats"],
    },
    capabilities: {
      identity: "verified",
      faction: "verified",
      liveChain: "verified",
      completedChains: "verified",
      members: "verified",
      chainReports: "verified",
    },
    checkedAt: new Date().toISOString(),
  };
}

export function isOfflineFixtureKey(apiKey: string): boolean {
  return offlineTestModeEnabled() && Object.values(OFFLINE_IDENTITIES).some((identity) => identity.apiKey === apiKey);
}

export function createOfflineFixtureFetch(apiKey: string): typeof fetch {
  if (!isOfflineFixtureKey(apiKey)) throw new Error("The offline test identity is invalid.");
  const actor = Object.values(OFFLINE_IDENTITIES).find((identity) => identity.apiKey === apiKey)!;
  return async (input: string | URL | Request): Promise<Response> => {
    const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
    const now = Math.floor(Date.now() / 1_000);
    const path = requestUrl.pathname;

    if (path.endsWith("/key/info")) return json({
      info: {
        selections: { faction: ["basic", "chain", "chains", "chainreport", "members", "crimes"], user: ["basic", "profile", "battlestats"], key: ["info"] },
        access: { level: 2, type: "Limited Access", faction: true, company: false },
        user: { id: actor.id, faction_id: OFFLINE_FACTION.id, company_id: null },
      },
    });
    if (path.endsWith("/user/basic")) return json({ profile: profileFor(actor.id, actor.name) });
    if (path.endsWith("/user/battlestats")) return json({ battlestats: battleStats(actor.id) });
    if (/\/faction(?:\/\d+)?\/crimes$/.test(path)) {
      const category = requestUrl.searchParams.get("cat") === "completed" ? "completed" : "available";
      const offset = Number.parseInt(requestUrl.searchParams.get("offset") ?? "0", 10) || 0;
      // A single page holds every fixture crime; a non-zero offset is the end.
      const crimes = offset > 0 ? [] : category === "completed" ? completedCrimes(now) : activeCrimes(actor.id, now);
      return json({ crimes, _metadata: { links: { next: null } } });
    }
    if (path.endsWith("/user/profile")) return json({ profile: { id: actor.id, name: actor.name, image: null } });
    if (/\/faction(?:\/\d+)?\/basic$/.test(path)) return json({
      basic: {
        id: OFFLINE_FACTION.id,
        name: OFFLINE_FACTION.name,
        tag: OFFLINE_FACTION.tag,
        tag_image: "",
        banner_image: "",
        leader_id: OFFLINE_IDENTITIES.owner.id,
        co_leader_id: OFFLINE_IDENTITIES.member.id,
        respect: 1_840_220,
        days_old: 640,
        capacity: 100,
        members: 6,
        is_enlisted: true,
        rank: { level: 12, name: "Platinum" },
        best_chain: 1_000,
      },
    });
    if (/\/faction(?:\/\d+)?\/chain$/.test(path)) return json({
      chain: { id: 7_000_004, current: 742, max: 1_000, timeout: 238, modifier: 1.5, cooldown: 0, start: now - 28_400, end: 0 },
    });
    if (/\/faction(?:\/\d+)?\/chains$/.test(path)) return json({
      chains: [
        { id: 7_000_003, chain: 500, respect: 8_412.36, start: now - 604_800, end: now - 583_200 },
        { id: 7_000_002, chain: 250, respect: 3_941.74, start: now - 1_209_600, end: now - 1_195_200 },
        { id: 7_000_001, chain: 100, respect: 1_204.12, start: now - 1_814_400, end: now - 1_807_200 },
      ],
      _metadata: { links: {} },
    });
    if (/\/faction(?:\/\d+)?\/members$/.test(path)) return json({ members: members(now) });
    if (/\/faction(?:\/\d+)?\/chainreport$/.test(path)) {
      const explicitId = path.match(/\/faction\/(\d+)\/chainreport$/)?.[1];
      const chainId = explicitId ? Number(explicitId) : 7_000_004;
      return json({ chainreport: chainReport(chainId, now) });
    }
    return json({ error: { code: 6, error: "Unknown offline fixture endpoint." } }, 404);
  };
}

function members(now: number) {
  return [
    member(OFFLINE_IDENTITIES.owner.id, OFFLINE_IDENTITIES.owner.name, "Leader", 100, now - 120, "Okay"),
    member(OFFLINE_IDENTITIES.member.id, OFFLINE_IDENTITIES.member.name, "Co-leader", 92, now - 480, "Okay"),
    member(9_000_002, "Nova Chain", "Chain lead", 84, now - 3_200, "Okay"),
    member(9_000_003, "Mint Signal", "Member", 77, now - 86_400 * 2, "Hospital"),
    member(9_000_004, "Quiet Vector", "Member", 69, now - 86_400 * 9, "Okay"),
    member(9_000_005, "Arc Runner", "Recruit", 51, now - 86_400 * 16, "Federal"),
  ];
}

function profileFor(id: number, name: string) {
  return { id, name, level: id === OFFLINE_IDENTITIES.owner.id ? 100 : 92, gender: "Unknown", status: { description: "Okay", details: null, state: "Okay", until: null, color: "green" } };
}

function member(id: number, name: string, position: string, level: number, lastAction: number, state: string) {
  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1_000) - lastAction);
  const ageDays = Math.floor(ageSeconds / 86_400);
  const relative = ageDays > 0 ? `${ageDays} day${ageDays === 1 ? "" : "s"} ago` : `${Math.max(1, Math.floor(ageSeconds / 60))} minutes ago`;
  return {
    id,
    name,
    position,
    level,
    days_in_faction: Math.max(10, 900 - (id % 500)),
    is_revivable: true,
    is_on_wall: false,
    is_in_oc: id % 2 === 0,
    has_early_discharge: false,
    last_action: { status: ageDays > 7 ? "Offline" : "Online", timestamp: lastAction, relative },
    status: { description: state, details: null, state, until: null, color: state === "Okay" ? "green" : "red" },
    revive_setting: "Everyone",
  };
}

function chainReport(chainId: number, now: number) {
  const completed = chainId !== 7_000_004;
  const hits = chainId === 7_000_003 ? 500 : chainId === 7_000_002 ? 250 : chainId === 7_000_001 ? 100 : 742;
  const attackerIds = [OFFLINE_IDENTITIES.owner.id, OFFLINE_IDENTITIES.member.id, 9_000_002, 9_000_003, 9_000_004, 9_000_005];
  const hitWeights = [0.24, 0.21, 0.18, 0.15, 0.13, 0.09];
  const allocated = hitWeights.map((weight) => Math.floor(hits * weight));
  allocated[0] = (allocated[0] ?? 0) + hits - allocated.reduce((total, value) => total + value, 0);
  return {
    id: chainId,
    faction_id: OFFLINE_FACTION.id,
    start: now - (completed ? 604_800 : 28_400),
    end: completed ? now - 583_200 : 0,
    details: { chain: hits, respect: hits * 16.42, members: attackerIds.length, targets: Math.ceil(hits * 0.74), war: 0, best: 4.9, leave: 0, mug: 0, hospitalize: hits, assists: 0, retaliations: 0, overseas: 0, draws: 0, escapes: 0, losses: 0 },
    bonuses: [],
    attackers: attackerIds.map((id, index) => ({
      id,
      respect: { total: allocated[index]! * 16.42, average: 16.42, best: 4.9 },
      attacks: { total: allocated[index]!, leave: 0, mug: 0, hospitalize: allocated[index]!, assists: 0, retaliations: 0, overseas: 0, draws: 0, escapes: 0, losses: 0, war: 0, bonuses: 0 },
    })),
    non_attackers: [],
  };
}

function battleStats(id: number) {
  const seed = id % 1_000;
  const multiplier = id === OFFLINE_IDENTITIES.owner.id ? 5 : id === OFFLINE_IDENTITIES.member.id ? 3 : 1;
  const strength = (400_000_000 + seed * 1_100_000) * multiplier;
  const defense = (380_000_000 + seed * 970_000) * multiplier;
  const speed = (350_000_000 + seed * 1_050_000) * multiplier;
  const dexterity = (360_000_000 + seed * 1_010_000) * multiplier;
  return {
    strength: { value: strength },
    defense: { value: defense },
    speed: { value: speed },
    dexterity: { value: dexterity },
    total: strength + defense + speed + dexterity,
  };
}

/** Torn returns the requesting key owner's checkpoint pass rate on empty slots. */
function ownEmptySlotCpr(actorId: number): { a: number; b: number; c: number } {
  if (actorId === OFFLINE_IDENTITIES.owner.id) return { a: 92, b: 85, c: 78 };
  if (actorId === OFFLINE_IDENTITIES.member.id) return { a: 74, b: 61, c: 88 };
  return { a: 55, b: 40, c: 66 };
}

function crimeSlot(
  position: string,
  positionId: string,
  label: string,
  user: { id: number; joined_at: number } | null,
  checkpointPassRate: number | null,
  item: { id: number; is_available: boolean; is_reusable: boolean } | null,
) {
  return { position, position_info: { id: positionId, label }, user, checkpoint_pass_rate: checkpointPassRate, item_requirement: item };
}

function activeCrimes(actorId: number, now: number) {
  const cpr = ownEmptySlotCpr(actorId);
  return [
    {
      id: 8_000_001, name: "Stage Robbery", difficulty: 7, status: "Recruiting",
      created_at: now - 7_200, expired_at: now + 86_400 * 3, executed_at: null, ready_at: null,
      slots: [
        crimeSlot("Robber", "1", "Robber #1", null, cpr.a, null),
        crimeSlot("Robber", "2", "Robber #2", null, cpr.b, { id: 568, is_available: true, is_reusable: false }),
        crimeSlot("Lookout", "1", "Lookout", { id: OFFLINE_IDENTITIES.owner.id, joined_at: now - 3_600 }, null, null),
      ],
    },
    {
      id: 8_000_002, name: "Bank Job", difficulty: 9, status: "Planning",
      created_at: now - 172_800, expired_at: now + 86_400 * 5, executed_at: null, ready_at: now + 3_600,
      slots: [
        crimeSlot("Driver", "1", "Getaway Driver", null, cpr.c, { id: 60, is_available: false, is_reusable: true }),
        crimeSlot("Hacker", "1", "Hacker", { id: OFFLINE_IDENTITIES.member.id, joined_at: now - 7_200 }, null, null),
        crimeSlot("Muscle", "1", "Muscle", { id: 9_000_002, joined_at: now - 7_100 }, null, null),
      ],
    },
  ];
}

function completedCrimes(now: number) {
  return [
    {
      id: 8_000_050, name: "Stage Robbery", difficulty: 7, status: "Successful",
      created_at: now - 86_400 * 4, expired_at: now - 86_400 * 3, executed_at: now - 86_400 * 2, ready_at: now - 86_400 * 2,
      slots: [
        crimeSlot("Robber", "1", "Robber #1", { id: OFFLINE_IDENTITIES.owner.id, joined_at: now - 86_400 * 3 }, 90, null),
        crimeSlot("Robber", "2", "Robber #2", { id: 9_000_002, joined_at: now - 86_400 * 3 }, 66, null),
        crimeSlot("Lookout", "1", "Lookout", { id: OFFLINE_IDENTITIES.member.id, joined_at: now - 86_400 * 3 }, 81, null),
      ],
    },
    {
      id: 8_000_051, name: "Pawn Shop Heist", difficulty: 5, status: "Failure",
      created_at: now - 86_400 * 6, expired_at: now - 86_400 * 5, executed_at: now - 86_400 * 4, ready_at: now - 86_400 * 4,
      slots: [
        crimeSlot("Thief", "1", "Thief", { id: OFFLINE_IDENTITIES.member.id, joined_at: now - 86_400 * 5 }, 47, null),
      ],
    },
  ];
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
