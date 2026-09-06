import "server-only";

import { TornApiError, userFacingTornError } from "@/lib/torn/errors";
import type { TornClient } from "@/lib/torn/client";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { isAttackableState, TARGET_STALE_MS, type TargetEntry, type TargetSnapshot } from "./types";

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

function snapshotFromProfile(tornUserId: number, profile: Awaited<ReturnType<TornClient["getUserProfileById"]>>["value"]["profile"], fetchedAtMs: number): TargetSnapshot {
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
    lifeCurrent: profile.life?.current ?? 0,
    lifeMaximum: profile.life?.maximum ?? 0,
    attackable: isAttackableState(state),
    fetchedAt: new Date(fetchedAtMs).toISOString(),
  };
}

/** One target's profile — used when a target is first added. */
export async function fetchTargetSnapshot(client: TornClient, tornUserId: number): Promise<TargetSnapshot> {
  const { value, fetchedAt } = await client.getUserProfileById(tornUserId);
  return snapshotFromProfile(tornUserId, value.profile, fetchedAt);
}

/**
 * Refreshes the snapshots that are missing or stale (or every one when `force`).
 * Individual target failures are tolerated — the stale snapshot is kept and the
 * reason recorded in `errors`. Sequential and capped by the caller's 40-target
 * list; the Torn client's 60s cache and retry/backoff bound the request cost.
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
  const snapshots: TargetSnapshot[] = [];
  const errors: Record<number, string> = {};

  for (const entry of entries) {
    const current = existingSnapshots[String(entry.tornUserId)];
    const age = current ? nowMs - Date.parse(current.fetchedAt) : Number.POSITIVE_INFINITY;
    if (!force && current && Number.isFinite(age) && age >= 0 && age < maxAgeMs) continue;
    try {
      snapshots.push(await fetchTargetSnapshot(connection.client, entry.tornUserId));
    } catch (error: unknown) {
      errors[entry.tornUserId] = error instanceof TornApiError
        ? userFacingTornError(error)
        : "Torn did not return this player's profile.";
    }
  }

  return { snapshots, errors, fetchedAt: new Date(nowMs).toISOString(), source, disconnected: false };
}
