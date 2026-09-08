import "server-only";

import { TornApiError, userFacingTornError } from "@/lib/torn/errors";
import { acquireConcurrencySlot } from "@/lib/security/rate-limit";
import type { TornClient } from "@/lib/torn/client";
import type { FactionMembersResponse, UserAttacksResponse, UserBountiesResponse } from "@/lib/torn/schemas";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { isAttackableState, TARGET_STALE_MS, type TargetEntry, type TargetLastHit, type TargetSnapshot } from "./types";

export interface TargetRefreshResult {
  snapshots: TargetSnapshot[];
  /** Per-target failure notes, keyed by Torn user ID. */
  errors: Record<number, string>;
  fetchedAt: string;
  source: string;
  /** True when no Torn connection is configured. */
  disconnected: boolean;
}

interface RefreshOptions {
  force?: boolean;
  maxAgeMs?: number;
}

export interface HitInfo {
  lastHit: TargetLastHit | null;
  hitYouBack: boolean;
}

const NO_HIT: HitInfo = { lastHit: null, hitYouBack: false };

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
 * From the operator's attack log, the most recent hit they landed on each
 * player and whether that player has since hit them back.
 */
export function buildHitIndex(response: UserAttacksResponse, operatorId: number): Map<number, HitInfo> {
  const index = new Map<number, HitInfo>();
  // Torn returns DESC (newest first); the first entry we see per player wins.
  for (const attack of response.attacks) {
    const attackerId = attack.attacker?.id ?? 0;
    const defenderId = attack.defender?.id ?? 0;
    const ended = attack.ended || attack.started;

    if (attackerId === operatorId && defenderId > 0) {
      const current = index.get(defenderId);
      if (!current || !current.lastHit) {
        index.set(defenderId, {
          lastHit: { at: ended, result: attack.result, respect: attack.respect_gain },
          hitYouBack: current?.hitYouBack ?? false,
        });
      }
    } else if (defenderId === operatorId && attackerId > 0) {
      const current = index.get(attackerId) ?? NO_HIT;
      // Only a "hit back" if it happened after our most recent hit on them.
      if (!current.lastHit || ended > current.lastHit.at) {
        index.set(attackerId, { ...current, hitYouBack: true });
      }
    }
  }
  return index;
}

/** Builds the hit index once per batch — every caller that fetches one or
 *  more target profiles shares this instead of re-reading the attack log. */
export async function loadHitIndex(client: TornClient, operatorId: number): Promise<Map<number, HitInfo>> {
  try {
    const { value } = await client.getMyAttacks();
    return buildHitIndex(value, operatorId);
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
    bountyTotal: 0,
    bountyCount: 0,
    fetchedAt: new Date(fetchedAtMs - TARGET_STALE_MS - 1_000).toISOString(),
  };
}

/**
 * Refreshes the snapshots that are missing or stale (or every one when
 * `force`), enriched with the operator's own recent attacks and bounties on
 * each target. Individual target failures are tolerated — the stale snapshot
 * is kept and the reason recorded in `errors`. Bounded concurrency (see
 * `fetchTargetSnapshots`) keeps a large forced refresh fast without exceeding
 * Torn's shared per-user rate limit.
 */
export async function refreshTargets(
  entries: TargetEntry[],
  existingSnapshots: Record<string, TargetSnapshot>,
  { force = false, maxAgeMs = TARGET_STALE_MS }: RefreshOptions = {},
): Promise<TargetRefreshResult> {
  const connection = await getConfiguredTornConnection();
  const nowMs = Date.now();
  if (!connection) {
    return { snapshots: [], errors: {}, fetchedAt: new Date(nowMs).toISOString(), source: "Unavailable", disconnected: true };
  }

  const source = connection.client.dataMode === "offline" ? "Offline fixture" : "Torn API v2";

  const due = entries.filter((entry) => {
    if (force) return true;
    const current = existingSnapshots[String(entry.tornUserId)];
    if (!current) return true;
    const age = nowMs - Date.parse(current.fetchedAt);
    return !Number.isFinite(age) || age < 0 || age >= maxAgeMs;
  });

  if (due.length === 0) {
    return { snapshots: [], errors: {}, fetchedAt: new Date(nowMs).toISOString(), source, disconnected: false };
  }

  const hitIndex = await loadHitIndex(connection.client, connection.tornUserId);
  const { snapshots, errors } = await fetchTargetSnapshots(connection.client, due.map((entry) => entry.tornUserId), hitIndex, connection.tornUserId);

  return { snapshots, errors, fetchedAt: new Date(nowMs).toISOString(), source, disconnected: false };
}
