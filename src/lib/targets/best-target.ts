import "server-only";

import { getCurrentActor } from "@/lib/auth/current-actor";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { fetchTargetSnapshot, loadHitIndex, refreshDueTargetsForList } from "./data-service";
import { enrichWithFairFight } from "./ffscouter";
import { scoreTarget } from "./priority";
import { mergeSnapshots, readTargetList, writeTargetList } from "./store";
import { isAttackableState, type TargetSnapshot } from "./types";

// Keep large lists moving without spending the whole API budget on profiles
// that will never be suggested. The selected candidate gets its own live check.
const LIVE_REFRESH_BUDGET = 2;
const CANDIDATE_CHECK_BUDGET = 3;
const RECENT_ATTACK_MS = 5 * 60_000;
const FRESH = { forceRefresh: true, bypassUpstreamCache: true } as const;

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
  /** No attack link is shown when the remaining candidates cannot be verified. */
  verificationUnavailable?: boolean;
}

const NONE: BestChainTargetResult = { target: null, targetCount: 0 };

/**
 * Reuses the Targets workspace's own hit-priority scoring to answer "who
 * should I hit right now to keep this chain alive" from the Active Chain
 * page. Recent personal attacks override cached readiness, and the winning
 * candidate is checked directly with Torn before an attack link is returned.
 * A click alone is never treated as proof that an attack happened.
 */
export async function getBestChainTarget(): Promise<BestChainTargetResult> {
  const [actor, connection] = await Promise.all([getCurrentActor(), getConfiguredTornConnection()]);
  const factionId = connection?.factionId ?? null;
  if (!factionId || !connection || connection.tornUserId !== actor.tornUserId) return NONE;

  let entries, snapshots;
  try {
    ({ entries, snapshots } = await readTargetList(factionId, actor.tornUserId));
  } catch {
    return NONE;
  }
  if (entries.length === 0) return NONE;

  // This must run even when every stored profile is "fresh". An attack just
  // before opening the page otherwise remains invisible for 45–60 seconds.
  const hitIndex = await loadHitIndex(connection.client, actor.tornUserId, FRESH);
  const faction = { id: factionId, name: connection.factionName ?? "", tag: connection.factionTag ?? "" };
  try {
    snapshots = await refreshDueTargetsForList(faction, actor.tornUserId, entries, snapshots, LIVE_REFRESH_BUDGET);
  } catch {
    /* Candidates are still individually verified below. */
  }

  const now = Date.now();
  const eligible = (snapshot: TargetSnapshot): boolean =>
    snapshot.tornUserId !== actor.tornUserId && snapshot.factionId !== factionId &&
    isAttackableState(snapshot.status.state) &&
    (!snapshot.lastHit || now - snapshot.lastHit.at * 1_000 >= RECENT_ATTACK_MS);
  const attackable = entries.flatMap((entry) => {
    const snapshot = snapshots[String(entry.tornUserId)];
    if (!snapshot) return [];
    const hit = hitIndex.get(entry.tornUserId);
    // Never replace newer saved history with an older/cached log response.
    const current = hit?.lastHit && hit.lastHit.at >= (snapshot.lastHit?.at ?? 0)
      ? { ...snapshot, lastHit: hit.lastHit, hitYouBack: hit.hitYouBack, hitStats: hit.stats }
      : snapshot;
    return eligible(current) ? [current] : [];
  });
  if (attackable.length === 0) return { target: null, targetCount: entries.length };

  let fairFight = new Map<number, number | null>();
  try {
    const enriched = await enrichWithFairFight(factionId, actor.tornUserId, attackable.map((snapshot) => snapshot.tornUserId));
    fairFight = new Map([...enriched].map(([tornUserId, info]) => [tornUserId, info.fairFight]));
  } catch {
    /* Fair Fight is an enrichment only — score without it. */
  }

  const pinnedIds = new Set(entries.filter((entry) => entry.pinned).map((entry) => entry.tornUserId));
  const rank = (snapshot: TargetSnapshot) => scoreTarget({
    snapshot,
    fairFight: fairFight.get(snapshot.tornUserId) ?? null,
    pinned: pinnedIds.has(snapshot.tornUserId),
    now,
  });
  const ranked = attackable.map((snapshot) => ({ snapshot, ...rank(snapshot) }))
    .sort((a, b) => b.score - a.score || a.snapshot.tornUserId - b.snapshot.tornUserId);
  const checked: TargetSnapshot[] = [];
  let best: { snapshot: TargetSnapshot; score: number; reasons: string[] } | null = null;
  let verificationUnavailable = false;
  for (const candidate of ranked.slice(0, CANDIDATE_CHECK_BUDGET)) {
    try {
      const snapshot = await fetchTargetSnapshot(connection.client, candidate.snapshot.tornUserId, {
        lastHit: candidate.snapshot.lastHit,
        hitYouBack: candidate.snapshot.hitYouBack,
        stats: candidate.snapshot.hitStats,
      }, FRESH);
      checked.push(snapshot);
      if (!eligible(snapshot)) continue;
      best = { snapshot, ...rank(snapshot) };
      break;
    } catch {
      // A failed check must not put the old, possibly hospitalised pick back.
      verificationUnavailable = true;
    }
  }
  if (checked.length > 0) {
    try {
      // Re-read curation so a concurrent removal/pin edit is not overwritten.
      const latest = await readTargetList(factionId, actor.tornUserId);
      const tracked = new Set(latest.entries.map((entry) => entry.tornUserId));
      await writeTargetList(faction, actor.tornUserId, mergeSnapshots(latest, checked.filter((snapshot) => tracked.has(snapshot.tornUserId))));
    } catch { /* Verification remains valid if persistence is unavailable. */ }
  }
  if (!best) return {
    target: null,
    targetCount: entries.length,
    // There may be more candidates than can safely be checked in one request.
    ...(verificationUnavailable || ranked.length > CANDIDATE_CHECK_BUDGET ? { verificationUnavailable: true } : {}),
  };

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
