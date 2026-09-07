import "server-only";

import { TornApiError, userFacingTornError } from "@/lib/torn/errors";
import type { TornClient } from "@/lib/torn/client";
import type { UserAttacksResponse } from "@/lib/torn/schemas";
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

interface HitInfo {
  lastHit: TargetLastHit | null;
  hitYouBack: boolean;
}

type ProfilePayload = Awaited<ReturnType<TornClient["getUserProfileById"]>>["value"]["profile"];

function snapshotFromProfile(tornUserId: number, profile: ProfilePayload, fetchedAtMs: number, hit: HitInfo = { lastHit: null, hitYouBack: false }): TargetSnapshot {
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
    fetchedAt: new Date(fetchedAtMs).toISOString(),
  };
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
      const current = index.get(attackerId) ?? { lastHit: null, hitYouBack: false };
      // Only a "hit back" if it happened after our most recent hit on them.
      if (!current.lastHit || ended > current.lastHit.at) {
        index.set(attackerId, { ...current, hitYouBack: true });
      }
    }
  }
  return index;
}

async function loadHitIndex(client: TornClient, operatorId: number): Promise<Map<number, HitInfo>> {
  try {
    const { value } = await client.getMyAttacks();
    return buildHitIndex(value, operatorId);
  } catch {
    // Attack history is enrichment only — a missing selection or a transient
    // failure must never block a status refresh.
    return new Map();
  }
}

/** One target's profile — used when a target is first added. */
export async function fetchTargetSnapshot(client: TornClient, tornUserId: number): Promise<TargetSnapshot> {
  const { value, fetchedAt } = await client.getUserProfileById(tornUserId);
  return snapshotFromProfile(tornUserId, value.profile, fetchedAt);
}

/**
 * Refreshes the snapshots that are missing or stale (or every one when `force`),
 * enriched with the operator's own recent attacks. Individual target failures
 * are tolerated — the stale snapshot is kept and the reason recorded in
 * `errors`. Sequential and capped by the caller's 40-target list; the Torn
 * client's cache and retry/backoff bound the request cost.
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
  const snapshots: TargetSnapshot[] = [];
  const errors: Record<number, string> = {};

  for (const entry of due) {
    try {
      const { value, fetchedAt } = await connection.client.getUserProfileById(entry.tornUserId);
      snapshots.push(snapshotFromProfile(
        entry.tornUserId,
        value.profile,
        fetchedAt,
        hitIndex.get(entry.tornUserId) ?? { lastHit: null, hitYouBack: false },
      ));
    } catch (error: unknown) {
      errors[entry.tornUserId] = error instanceof TornApiError
        ? userFacingTornError(error)
        : "Torn did not return this player's profile.";
    }
  }

  return { snapshots, errors, fetchedAt: new Date(nowMs).toISOString(), source, disconnected: false };
}
