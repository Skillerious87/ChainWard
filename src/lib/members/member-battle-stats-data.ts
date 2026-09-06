import "server-only";

import { cache } from "react";
import { TornApiError, userFacingTornError } from "@/lib/torn/errors";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import type { BattleStats } from "./member-battle-stats";

export interface OwnBattleStatsDraft {
  stats: BattleStats;
  statsAt: string;
  source: "torn" | "offline";
}

export type OwnBattleStatsResult =
  | { ok: true; draft: OwnBattleStatsDraft }
  | { ok: false; message: string };

/**
 * Reads the signed-in member's own battle stats from their own Torn key. Nothing
 * is persisted here — the server action decides whether to store the snapshot.
 */
export const getOwnBattleStatsDraft = cache(async (): Promise<OwnBattleStatsResult> => {
  const connection = await getConfiguredTornConnection();
  if (!connection) return { ok: false, message: "Connect your Torn API key before sharing your battle stats." };

  let statsResponse: Awaited<ReturnType<typeof connection.client.getMyBattleStats>>;
  try {
    statsResponse = await connection.client.getMyBattleStats();
  } catch (error: unknown) {
    if (error instanceof TornApiError && error.category === "INSUFFICIENT_PERMISSION") {
      return { ok: false, message: "Your Torn API key does not grant battle-stat access. Reconnect with a key that includes it, then try again." };
    }
    return { ok: false, message: safeError(error) };
  }

  const bs = statsResponse.value.battlestats as Record<string, unknown>;
  const strength = readStatValue(bs.strength);
  const defense = readStatValue(bs.defense);
  const speed = readStatValue(bs.speed);
  const dexterity = readStatValue(bs.dexterity);
  const total = readStatValue(bs.total) || strength + defense + speed + dexterity;
  if (total <= 0) {
    return { ok: false, message: "Torn returned no battle-stat values for your key. Make sure the key includes battle-stat access, then try again." };
  }

  return {
    ok: true,
    draft: {
      stats: { strength, defense, speed, dexterity, total },
      statsAt: new Date(statsResponse.fetchedAt).toISOString(),
      source: connection.client.dataMode === "offline" ? "offline" : "torn",
    },
  };
});

/** Torn v2 has returned each battle stat as a plain number and as `{ value }`. */
function readStatValue(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  if (raw && typeof raw === "object" && "value" in raw) {
    const value = (raw as { value: unknown }).value;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

function safeError(error: unknown): string {
  return error instanceof TornApiError
    ? userFacingTornError(error)
    : "Torn data could not be validated. No values were displayed.";
}
