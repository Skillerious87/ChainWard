import "server-only";

import { getCurrentActor } from "@/lib/auth/current-actor";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { enrichWithFairFight } from "./ffscouter";
import { scoreTarget } from "./priority";
import { readTargetList } from "./store";
import { isAttackableState, type TargetSnapshot } from "./types";

export interface BestChainTarget {
  tornUserId: number;
  name: string;
  level: number;
  factionName: string;
  score: number;
  /** Ordered most-important-first, "Ready" already excluded — every candidate is. */
  reasons: string[];
  fairFight: number | null;
  attackUrl: string;
}

export interface BestChainTargetResult {
  /** The highest hit-priority target that is attackable right now, or null when none is. */
  target: BestChainTarget | null;
  /** Total targets on the operator's list, so the caller can tell "none ready" from "no list yet". */
  targetCount: number;
}

const NONE: BestChainTargetResult = { target: null, targetCount: 0 };

/**
 * Reuses the Targets workspace's own hit-priority scoring to answer "who
 * should I hit right now to keep this chain alive" from the Active Chain
 * page. Reads the operator's already-cached target list rather than forcing
 * a fresh Torn fetch, so this costs nothing beyond what the Targets page
 * already keeps current; Fair Fight enrichment shares the same process-wide
 * cache as that page too.
 */
export async function getBestChainTarget(): Promise<BestChainTargetResult> {
  const [actor, connection] = await Promise.all([getCurrentActor(), getConfiguredTornConnection()]);
  const factionId = connection?.factionId ?? null;
  if (!factionId || !connection) return NONE;

  let entries, snapshots;
  try {
    ({ entries, snapshots } = await readTargetList(factionId, actor.tornUserId));
  } catch {
    return NONE;
  }
  if (entries.length === 0) return NONE;

  const attackable = Object.values(snapshots).filter((snapshot) => isAttackableState(snapshot.status.state));
  if (attackable.length === 0) return { target: null, targetCount: entries.length };

  let fairFight = new Map<number, number | null>();
  try {
    const enriched = await enrichWithFairFight(factionId, actor.tornUserId, attackable.map((snapshot) => snapshot.tornUserId));
    fairFight = new Map([...enriched].map(([tornUserId, info]) => [tornUserId, info.fairFight]));
  } catch {
    /* Fair Fight is an enrichment only — score without it. */
  }

  const pinnedIds = new Set(entries.filter((entry) => entry.pinned).map((entry) => entry.tornUserId));
  const now = Date.now();
  let best: { snapshot: TargetSnapshot; score: number; reasons: string[] } | null = null;
  for (const snapshot of attackable) {
    const { score, reasons } = scoreTarget({
      snapshot,
      fairFight: fairFight.get(snapshot.tornUserId) ?? null,
      pinned: pinnedIds.has(snapshot.tornUserId),
      now,
    });
    if (!best || score > best.score) best = { snapshot, score, reasons };
  }
  if (!best) return { target: null, targetCount: entries.length };

  return {
    targetCount: entries.length,
    target: {
      tornUserId: best.snapshot.tornUserId,
      name: best.snapshot.name || `Player ${best.snapshot.tornUserId}`,
      level: best.snapshot.level,
      factionName: best.snapshot.factionName,
      score: best.score,
      reasons: best.reasons.filter((reason) => reason !== "Ready"),
      fairFight: fairFight.get(best.snapshot.tornUserId) ?? null,
      attackUrl: `https://www.torn.com/page.php?sid=attack&user2ID=${best.snapshot.tornUserId}`,
    },
  };
}
