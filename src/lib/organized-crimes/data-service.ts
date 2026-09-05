import "server-only";

import { cache } from "react";
import { TornApiError, userFacingTornError } from "@/lib/torn/errors";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { collectOwnRoles } from "./intelligence";
import { crimeSchema, type BattleStats, type CrimeFeed, type OrganizedCrime, type RoleObservation } from "./types";

const MAX_PAGES = 10;
const MAX_CRIMES = 1_000;

export interface OwnOcIntelDraft {
  stats: BattleStats;
  statsAt: string;
  roles: RoleObservation[];
  rolesMessage: string;
  source: "torn" | "offline";
}

export type OwnOcIntelResult =
  | { ok: true; draft: OwnOcIntelDraft }
  | { ok: false; message: string };

/**
 * Reads the connected faction's organized crimes for the signed-in operator's
 * key. Torn paginates `/faction/crimes`; this follows `_metadata.links.next`
 * up to a hard page cap so a very large history cannot stall a render. Each
 * crime is validated on its own — a single unparseable row (Torn adds fields
 * to the v2 payload without notice) is dropped, never fatal.
 */
export const getCrimeFeed = cache(async (category: "available" | "completed"): Promise<CrimeFeed> => {
  try {
    const connection = await getConfiguredTornConnection();
    if (!connection) {
      return { crimes: [], available: false, complete: false, fetchedAt: null, message: "Connect a Torn API key to review organized crimes." };
    }

    const collected: OrganizedCrime[] = [];
    let offset = 0;
    let fetchedAt = Date.now();
    let complete = false;
    let dropped = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { value, fetchedAt: at } = await connection.client.getOrganizedCrimes(category, offset);
      fetchedAt = at;
      for (const raw of value.crimes) {
        const parsed = crimeSchema.safeParse(raw);
        if (parsed.success) collected.push(parsed.data);
        else dropped += 1;
      }
      const next = value._metadata.links.next;
      if (!next || value.crimes.length === 0) { complete = true; break; }
      offset += value.crimes.length;
      if (collected.length >= MAX_CRIMES) break;
    }

    const base = connection.client.dataMode === "offline"
      ? "Organized crimes loaded from the offline test fixture."
      : "Organized crimes retrieved from Torn API v2.";
    return {
      crimes: collected,
      available: true,
      complete,
      fetchedAt: new Date(fetchedAt).toISOString(),
      message: dropped > 0 ? `${base} ${dropped} row${dropped === 1 ? "" : "s"} were skipped as unreadable.` : base,
    };
  } catch (error: unknown) {
    return { crimes: [], available: false, complete: false, fetchedAt: null, message: safeError(error) };
  }
});

/**
 * Builds the sharable intelligence record for the *currently signed-in* member
 * from their own key: their real battle stats plus the live checkpoint pass
 * rates Torn returns on open OC slots for that key. Nothing is persisted here —
 * the server action decides whether to store it.
 */
export const getOwnOcIntelDraft = cache(async (): Promise<OwnOcIntelResult> => {
  const connection = await getConfiguredTornConnection();
  if (!connection) return { ok: false, message: "Connect your Torn API key before sharing OC data." };

  let statsResponse: Awaited<ReturnType<typeof connection.client.getMyBattleStats>>;
  try {
    statsResponse = await connection.client.getMyBattleStats();
  } catch (error: unknown) {
    if (error instanceof TornApiError && error.category === "INSUFFICIENT_PERMISSION") {
      return { ok: false, message: "Your Torn API key does not grant battle-stat access. Reconnect with a key that includes it, then try again." };
    }
    return { ok: false, message: safeError(error) };
  }

  const bs = statsResponse.value.battlestats;
  const stats: BattleStats = {
    strength: bs.strength.value,
    defense: bs.defense.value,
    speed: bs.speed.value,
    dexterity: bs.dexterity.value,
    total: bs.total,
  };
  const source: "torn" | "offline" = connection.client.dataMode === "offline" ? "offline" : "torn";

  const live = await getCrimeFeed("available");
  const observedAt = new Date().toISOString();
  const roles = live.available
    ? collectOwnRoles(live.crimes, connection.tornUserId, observedAt)
    : [];
  const rolesMessage = !live.available
    ? "Current OC slots could not be read, so no live role evidence was shared."
    : roles.length > 0
      ? `${roles.length} live checkpoint pass rate${roles.length === 1 ? "" : "s"} captured from open OC slots.`
      : "No open OC slots currently expose a checkpoint pass rate for your key.";

  return {
    ok: true,
    draft: { stats, statsAt: new Date(statsResponse.fetchedAt).toISOString(), roles, rolesMessage, source },
  };
});

function safeError(error: unknown): string {
  return error instanceof TornApiError
    ? userFacingTornError(error)
    : "Torn data could not be validated. No values were displayed.";
}
