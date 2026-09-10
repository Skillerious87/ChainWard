import "server-only";

import { TornApiError, userFacingTornError } from "@/lib/torn/errors";
import { acquireConcurrencySlot } from "@/lib/security/rate-limit";
import type { TornClient } from "@/lib/torn/client";
import type { FactionMembersResponse, UserAttacksResponse, UserBountiesResponse } from "@/lib/torn/schemas";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { isAttackableState, TARGET_STALE_MS, type TargetEntry, type TargetHitStats, type TargetLastHit, type TargetSnapshot } from "./types";

export interface TargetRefreshResult {
  snapshots: TargetSnapshot[];
  /** Per-target failure notes, keyed by Torn user ID. */
  errors: Record<number, string>;
  fetchedAt: string;
  source: string;
  /** True when no Torn connection is configured. */
  disconnected: boolean;
  /** How many targets were due before `budget` was applied — lets a caller
   *  loop until the backlog is drained and drive a progress bar. */
  dueTotal: number;
}

interface RefreshOptions {
  /** Ignore per-state freshness and treat every target as due. */
  force?: boolean;
  /** Uniform freshness override. When set it is used as a ceiling on top of the
   *  per-state cadence (nothing is considered fresh for longer than this). */
  maxAgeMs?: number;
  /** Fetch at most this many of the due targets, the most-in-need first. The
   *  rest wait for the next call — this is what keeps a 300-target list from
   *  firing 300 Torn requests at once. */
  budget?: number;
}

/** Longest a snapshot in any state is trusted before a refresh is due. */
const MAX_TIER_MS = 10 * 60_000;

/**
 * How long this target's last reading stays "fresh enough" — the heart of the
 * intelligent refresh. A target you can hit right now, or one about to clear
 * hospital, is re-read aggressively; someone sitting on a long hospital timer
 * or stranded abroad is left alone until shortly before their state can change.
 */
function tierMaxAgeMs(snapshot: TargetSnapshot | undefined, nowMs: number): number {
  if (!snapshot || snapshot.status.state === "") return 0; // never read / placeholder → always due
  const state = snapshot.status.state.toLowerCase();
  const untilMs = snapshot.status.until ? snapshot.status.until * 1_000 : 0;
  const toClearMs = untilMs > nowMs ? untilMs - nowMs : 0;

  if (isAttackableState(snapshot.status.state)) return 45_000;
  if (state.includes("hospital") || state.includes("jail") || state.includes("federal")) {
    if (toClearMs <= 0) return 30_000; // timer elapsed or unknown — poll for the flip
    if (toClearMs <= 3 * 60_000) return 30_000; // about to clear — catch it promptly
    return Math.min(MAX_TIER_MS, Math.max(60_000, toClearMs - 60_000));
  }
  if (state.includes("travel") || state.includes("abroad")) {
    return toClearMs > 0 && toClearMs <= 3 * 60_000 ? 30_000 : MAX_TIER_MS;
  }
  return 5 * 60_000;
}

interface DueEntry { entry: TargetEntry; snapshot: TargetSnapshot | undefined; ratio: number }

/** Ranks due targets so a bounded refresh spends its budget where it matters:
 *  never-read placeholders first, then the more overdue, weighted up for
 *  pinned / attackable / bountied / imminently-clearing targets. */
function needScore({ entry, snapshot, ratio }: DueEntry, nowMs: number): number {
  if (!snapshot || snapshot.status.state === "") return Number.MAX_SAFE_INTEGER;
  let score = Number.isFinite(ratio) ? ratio : 1_000;
  if (entry.pinned) score *= 1.4;
  if (snapshot.attackable) score *= 1.5;
  if (snapshot.bountyTotal > 0) score *= 1.25;
  const state = snapshot.status.state.toLowerCase();
  const untilMs = snapshot.status.until ? snapshot.status.until * 1_000 : 0;
  const toClearMs = untilMs > nowMs ? untilMs - nowMs : 0;
  if ((state.includes("hospital") || state.includes("jail")) && toClearMs > 0 && toClearMs <= 3 * 60_000) score *= 2;
  return score;
}

export interface HitInfo {
  lastHit: TargetLastHit | null;
  hitYouBack: boolean;
  /** Rolled-up history against this target, or null when the log holds nothing. */
  stats: TargetHitStats | null;
}

const NO_HIT: HitInfo = { lastHit: null, hitYouBack: false, stats: null };

/** Result strings that mean the operator's hit connected / failed. Torn keeps
 *  adding outcome types, so anything unrecognised (and `respect_gain <= 0`)
 *  counts as neither rather than being force-fit into a bucket. */
const WIN_RESULTS = new Set(["attacked", "mugged", "hospitalized", "looted", "arrested"]);
const LOSS_RESULTS = new Set(["lost", "stalemate", "escape", "timeout"]);

function emptyHitStats(): TargetHitStats {
  return { hitCount: 0, respectTotal: 0, respectAvg: 0, winCount: 0, lossCount: 0, hitBackCount: 0, lastResult: "", windowStartAt: 0 };
}

/** Every target profile fetch also asks Torn for that player's bounties (a
 *  separate endpoint), so this bounds both calls against one shared budget. */
const FETCH_SCOPE = "targets:torn-fetch";
const FETCH_CONCURRENCY = 6;

type ProfilePayload = Awaited<ReturnType<TornClient["getUserProfileById"]>>["value"]["profile"];

function snapshotFromProfile(
  tornUserId: number,
  profile: ProfilePayload,
  fetchedAtMs: number,
  hit: HitInfo,
  bounty: { bountyTotal: number; bountyCount: number },
): TargetSnapshot {
  const state = profile.status?.state ?? "";
  return {
    tornUserId,
    name: profile.name ?? "",
    level: profile.level ?? 0,
    factionId: profile.faction?.faction_id ? profile.faction.faction_id : null,
    factionName: profile.faction?.faction_name ?? "",
    position: profile.faction?.position ?? "",
    status: {
      description: profile.status?.description ?? "",
      state,
      until: profile.status?.until ?? null,
      color: profile.status?.color ?? "",
    },
    lastActionAt: profile.last_action?.timestamp ?? 0,
    lastActionRelative: profile.last_action?.relative ?? "",
    lastActionStatus: profile.last_action?.status ?? "",
    lifeCurrent: profile.life?.current ?? 0,
    lifeMaximum: profile.life?.maximum ?? 0,
    attackable: isAttackableState(state),
    lastHit: hit.lastHit,
    hitYouBack: hit.hitYouBack,
    hitStats: hit.stats,
    bountyTotal: bounty.bountyTotal,
    bountyCount: bounty.bountyCount,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
  };
}

function summarizeBounties(bounties: UserBountiesResponse | null | undefined): { bountyTotal: number; bountyCount: number } {
  let bountyTotal = 0;
  let bountyCount = 0;
  for (const bounty of bounties?.bounties ?? []) {
    const quantity = bounty.quantity > 0 ? bounty.quantity : 1;
    bountyTotal += bounty.reward * quantity;
    bountyCount += quantity;
  }
  return { bountyTotal, bountyCount };
}

/**
 * From the operator's attack log, per player: the most recent hit they landed,
 * whether that player has since hit them back, and a roll-up of the whole
 * window (count, respect, win/loss, times hit back) for the workspace's history
 * badges and priority score. Torn returns the log DESC (newest first), so the
 * first attacker-side row we see for a player is their most recent hit.
 */
export function buildHitStats(response: UserAttacksResponse, operatorId: number): Map<number, HitInfo> {
  const index = new Map<number, HitInfo>();
  const ensure = (id: number): HitInfo => {
    let info = index.get(id);
    if (!info) { info = { lastHit: null, hitYouBack: false, stats: null }; index.set(id, info); }
    return info;
  };

  for (const attack of response.attacks) {
    const attackerId = attack.attacker?.id ?? 0;
    const defenderId = attack.defender?.id ?? 0;
    const ended = attack.ended || attack.started;

    if (attackerId === operatorId && defenderId > 0) {
      const info = ensure(defenderId);
      const stats = info.stats ?? (info.stats = emptyHitStats());
      if (!info.lastHit) {
        info.lastHit = { at: ended, result: attack.result, respect: attack.respect_gain };
        stats.lastResult = attack.result;
      }
      stats.hitCount += 1;
      stats.respectTotal += attack.respect_gain;
      const result = attack.result.toLowerCase();
      if (attack.respect_gain > 0 || WIN_RESULTS.has(result)) stats.winCount += 1;
      else if (LOSS_RESULTS.has(result)) stats.lossCount += 1;
      stats.windowStartAt = stats.windowStartAt === 0 ? ended : Math.min(stats.windowStartAt, ended);
    } else if (defenderId === operatorId && attackerId > 0) {
      const info = ensure(attackerId);
      const stats = info.stats ?? (info.stats = emptyHitStats());
      stats.hitBackCount += 1;
      // Only a "hit back" if it happened after our most recent hit on them.
      if (!info.lastHit || ended > info.lastHit.at) info.hitYouBack = true;
    }
  }

  for (const info of index.values()) {
    if (info.stats && info.stats.hitCount > 0) info.stats.respectAvg = info.stats.respectTotal / info.stats.hitCount;
  }
  return index;
}

/** @deprecated Use {@link buildHitStats}. Kept as a name-only alias for existing callers. */
export const buildHitIndex = buildHitStats;

/** Builds the hit index once per batch — every caller that fetches one or
 *  more target profiles shares this instead of re-reading the attack log. */
export async function loadHitIndex(client: TornClient, operatorId: number): Promise<Map<number, HitInfo>> {
  try {
    const { value } = await client.getMyAttacks();
    return buildHitStats(value, operatorId);
  } catch {
    // Attack history is enrichment only — a missing selection or a transient
    // failure must never block a status refresh.
    return new Map();
  }
}

/** Reserves a slot before running `work`, polling briefly when the budget is
 *  momentarily exhausted (`acquireConcurrencySlot` rejects immediately rather
 *  than queueing). Bounds how many Torn calls one operator has in flight at
 *  once, across every target fetched in the same batch. */
async function withConcurrencySlot<T>(partition: string | number, limit: number, work: () => Promise<T>): Promise<T> {
  for (;;) {
    const release = acquireConcurrencySlot(FETCH_SCOPE, partition, limit);
    if (release) {
      try {
        return await work();
      } finally {
        release();
      }
    }
    await delay(30);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** One target's profile (+ bounties) — used when a target is first added.
 *  Not concurrency-bounded: a deliberate, low-frequency, single-target call. */
export async function fetchTargetSnapshot(client: TornClient, tornUserId: number, hit: HitInfo = NO_HIT): Promise<TargetSnapshot> {
  const [{ value, fetchedAt }, bounties] = await Promise.all([
    client.getUserProfileById(tornUserId),
    client.getUserBounties(tornUserId).catch(() => null),
  ]);
  return snapshotFromProfile(tornUserId, value.profile, fetchedAt, hit, summarizeBounties(bounties?.value));
}

type SnapshotFetchResult =
  | { ok: true; tornUserId: number; snapshot: TargetSnapshot }
  | { ok: false; tornUserId: number; message: string };

async function fetchOneBounded(client: TornClient, tornUserId: number, hit: HitInfo, operatorId: number): Promise<SnapshotFetchResult> {
  try {
    const profilePromise = withConcurrencySlot(operatorId, FETCH_CONCURRENCY, () => client.getUserProfileById(tornUserId));
    const bountyPromise = withConcurrencySlot(operatorId, FETCH_CONCURRENCY, () => client.getUserBounties(tornUserId)).catch(() => null);
    const [{ value, fetchedAt }, bounties] = await Promise.all([profilePromise, bountyPromise]);
    return { ok: true, tornUserId, snapshot: snapshotFromProfile(tornUserId, value.profile, fetchedAt, hit, summarizeBounties(bounties?.value)) };
  } catch (error: unknown) {
    return {
      ok: false,
      tornUserId,
      message: error instanceof TornApiError ? userFacingTornError(error) : "Torn did not return this player's profile.",
    };
  }
}

/**
 * Fetches many target profiles at once, bounded to `FETCH_CONCURRENCY`
 * in-flight Torn calls per operator rather than one at a time — a forced
 * refresh of a full list no longer waits on dozens of sequential round-trips.
 * One target's failure never affects another's.
 */
export async function fetchTargetSnapshots(
  client: TornClient,
  tornUserIds: number[],
  hitIndex: Map<number, HitInfo>,
  operatorId: number,
): Promise<{ snapshots: TargetSnapshot[]; errors: Record<number, string> }> {
  const results = await Promise.all(
    tornUserIds.map((tornUserId) => fetchOneBounded(client, tornUserId, hitIndex.get(tornUserId) ?? NO_HIT, operatorId)),
  );
  const snapshots: TargetSnapshot[] = [];
  const errors: Record<number, string> = {};
  for (const result of results) {
    if (result.ok) snapshots.push(result.snapshot);
    else errors[result.tornUserId] = result.message;
  }
  return { snapshots, errors };
}

/**
 * Builds a target snapshot straight from a bulk faction-roster read, with no
 * per-member Torn call. `fetchedAt` is deliberately backdated past
 * `TARGET_STALE_MS`, so the very next ordinary refresh (live poll or manual)
 * treats every imported member as due and backfills real life/bounty data
 * through the normal bounded profile fetch — a whole-faction import stays
 * cheap (two Torn calls, regardless of roster size) precisely because it
 * never tries to read each member's live status up front.
 */
/**
 * A "not read yet" snapshot for a target added by ID (e.g. a big pasted list).
 * Carries nothing but the id and a deliberately ancient `fetchedAt`, so the
 * import itself costs zero Torn calls and the next bounded refresh treats every
 * new target as top-priority due. Mirrors `snapshotFromFactionMember`, just
 * with no roster data to seed from.
 */
export function placeholderSnapshot(tornUserId: number, fetchedAtMs: number): TargetSnapshot {
  return {
    tornUserId,
    name: "",
    level: 0,
    factionId: null,
    factionName: "",
    position: "",
    status: { description: "", state: "", until: null, color: "" },
    lastActionAt: 0,
    lastActionRelative: "",
    lastActionStatus: "",
    lifeCurrent: 0,
    lifeMaximum: 0,
    attackable: false,
    lastHit: null,
    hitYouBack: false,
    hitStats: null,
    bountyTotal: 0,
    bountyCount: 0,
    fetchedAt: new Date(fetchedAtMs - 24 * 60 * 60_000).toISOString(),
  };
}

export function snapshotFromFactionMember(
  factionId: number,
  factionName: string,
  member: FactionMembersResponse["members"][number],
  fetchedAtMs: number,
): TargetSnapshot {
  const state = member.status?.state ?? "";
  return {
    tornUserId: member.id,
    name: member.name ?? "",
    level: member.level ?? 0,
    factionId,
    factionName,
    position: member.position ?? "",
    status: {
      description: member.status?.description ?? "",
      state,
      until: member.status?.until ?? null,
      color: member.status?.color ?? "",
    },
    lastActionAt: member.last_action?.timestamp ?? 0,
    lastActionRelative: member.last_action?.relative ?? "",
    lastActionStatus: member.last_action?.status ?? "",
    lifeCurrent: 0,
    lifeMaximum: 0,
    attackable: isAttackableState(state),
    lastHit: null,
    hitYouBack: false,
    hitStats: null,
    bountyTotal: 0,
    bountyCount: 0,
    fetchedAt: new Date(fetchedAtMs - TARGET_STALE_MS - 1_000).toISOString(),
  };
}

/**
 * Refreshes target snapshots that are due, enriched with the operator's own
 * recent attacks and bounties. "Due" is per-state (see `tierMaxAgeMs`): an
 * attackable or about-to-clear target is re-read within a minute, a long
 * hospital timer or an abroad target only every ~10 minutes — so a 300-target
 * list settles into a small steady trickle of Torn calls. `budget` then caps a
 * single call, spending it on the most-in-need targets first (`needScore`);
 * `dueTotal` reports the pre-budget backlog so a caller can loop. Individual
 * failures are tolerated — the stale snapshot is kept, the reason goes in
 * `errors`.
 */
export async function refreshTargets(
  entries: TargetEntry[],
  existingSnapshots: Record<string, TargetSnapshot>,
  { force = false, maxAgeMs, budget }: RefreshOptions = {},
): Promise<TargetRefreshResult> {
  const connection = await getConfiguredTornConnection();
  const nowMs = Date.now();
  if (!connection) {
    return { snapshots: [], errors: {}, fetchedAt: new Date(nowMs).toISOString(), source: "Unavailable", disconnected: true, dueTotal: 0 };
  }

  const source = connection.client.dataMode === "offline" ? "Offline fixture" : "Torn API v2";

  const dueEntries: DueEntry[] = [];
  for (const entry of entries) {
    const snapshot = existingSnapshots[String(entry.tornUserId)];
    const age = snapshot ? nowMs - Date.parse(snapshot.fetchedAt) : Number.POSITIVE_INFINITY;
    const threshold = force
      ? 0
      : Math.min(tierMaxAgeMs(snapshot, nowMs), maxAgeMs ?? Number.POSITIVE_INFINITY);
    const overdue = threshold <= 0 || !Number.isFinite(age) || age < 0 || age >= threshold;
    if (overdue) {
      dueEntries.push({ entry, snapshot, ratio: threshold > 0 && Number.isFinite(age) ? age / threshold : Number.POSITIVE_INFINITY });
    }
  }

  const dueTotal = dueEntries.length;
  if (dueTotal === 0) {
    return { snapshots: [], errors: {}, fetchedAt: new Date(nowMs).toISOString(), source, disconnected: false, dueTotal: 0 };
  }

  const picked = budget && budget > 0 && dueTotal > budget
    ? [...dueEntries].sort((a, b) => needScore(b, nowMs) - needScore(a, nowMs)).slice(0, budget)
    : dueEntries;

  const hitIndex = await loadHitIndex(connection.client, connection.tornUserId);
  const { snapshots, errors } = await fetchTargetSnapshots(connection.client, picked.map(({ entry }) => entry.tornUserId), hitIndex, connection.tornUserId);

  return { snapshots, errors, fetchedAt: new Date(nowMs).toISOString(), source, disconnected: false, dueTotal };
}
