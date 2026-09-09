import { isAttackableState, type TargetSnapshot } from "./types";

/**
 * A single "hit next" score for a target, folding every signal the Targets
 * workspace already collects into one 0–100 number plus a short list of the
 * reasons that moved it. Pure and client-safe — the workspace memoises it once
 * per render and shares the result between the sort and the card badge.
 *
 * The weighting is deliberately readiness-dominant: a target you can hit *now*
 * should almost always outrank one you can't, with winnability, reward and
 * "spread the chain around" freshness ordering targets that are otherwise
 * equally reachable. Pin is an additive nudge, not an override; a stale reading
 * scales the whole thing down because it shouldn't be trusted to top the queue.
 */

export interface PriorityInput {
  snapshot: TargetSnapshot | null;
  /** Estimated Fair Fight from ffscouter enrichment, or null when unknown. */
  fairFight: number | null;
  pinned: boolean;
  /** Millisecond clock the workspace already ticks once a second. */
  now: number;
}

export interface PriorityResult {
  score: number;
  /** Ordered most-important-first; callers typically show the first two or three. */
  reasons: string[];
}

const WEIGHTS = { readiness: 45, winnability: 25, reward: 15, freshness: 15 } as const;
const PINNED_BONUS = 12;
const FARM_BONUS = 5;
const HIT_BACK_PENALTY = 8;
const HITS_BACK_OFTEN_PENALTY = 7;

/** Minutes-to-clear past which a hospital/jail timer stops helping the score. */
const CLEAR_HORIZON_MIN = 30;
/** A reading older than this starts losing the target credibility. */
const STALE_MS = 5 * 60_000;
/** Days since the last hit at which "spread the chain" freshness maxes out. */
const FRESHNESS_HORIZON_DAYS = 7;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** ~"$2.5M" / "$900K" — small and self-contained so this module imports nothing. */
function compactMoney(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

function readinessScore(snapshot: TargetSnapshot, now: number): { value: number; reason: string | null } {
  if (isAttackableState(snapshot.status.state)) return { value: 1, reason: "Ready" };
  const until = snapshot.status.until ? snapshot.status.until * 1_000 : 0;
  const state = snapshot.status.state.toLowerCase();
  const inHold = state.includes("hospital") || state.includes("jail") || state.includes("federal");
  if (inHold) {
    if (until <= now) return { value: 0.15, reason: "Clearing" };
    const minutes = (until - now) / 60_000;
    const value = clamp01(1 - minutes / CLEAR_HORIZON_MIN);
    return { value, reason: minutes <= 10 ? `Clears in ${Math.max(1, Math.round(minutes))}m` : null };
  }
  if (state.includes("travel") || state.includes("abroad")) return { value: 0, reason: null };
  return { value: 0.05, reason: null };
}

function winnabilityScore(fairFight: number | null): { value: number; reason: string | null } {
  if (fairFight == null) return { value: 0.35, reason: null };
  // 1.5 or below → certain win; 5 or above → treat as unwinnable.
  const value = clamp01((5 - fairFight) / 3.5);
  const reason = fairFight <= 2 ? "Easy fight" : fairFight <= 3.5 ? "Fair fight" : fairFight > 4.5 ? "Hard fight" : null;
  return { value, reason };
}

function rewardScore(snapshot: TargetSnapshot): { value: number; reason: string | null } {
  if (snapshot.bountyTotal <= 0) return { value: 0, reason: null };
  const stacked = Math.min(0.15, Math.max(0, snapshot.bountyCount - 1) * 0.05);
  const value = clamp01(Math.log10(snapshot.bountyTotal) / 8 + stacked);
  return { value, reason: `${compactMoney(snapshot.bountyTotal)} bounty` };
}

function freshnessScore(snapshot: TargetSnapshot, now: number): { value: number; reason: string | null } {
  if (!snapshot.lastHit) return { value: 1, reason: "Never hit" };
  const days = Math.max(0, (now - snapshot.lastHit.at * 1_000) / 86_400_000);
  const value = clamp01(days / FRESHNESS_HORIZON_DAYS);
  return { value, reason: days >= 3 ? `Not hit in ${Math.round(days)}d` : null };
}

/** A target the operator has hit repeatedly and reliably won against, for good
 *  respect — worth floating up as a dependable chain filler. */
function isReliableFarm(snapshot: TargetSnapshot): boolean {
  const stats = snapshot.hitStats;
  if (!stats || stats.hitCount < 3) return false;
  const decided = stats.winCount + stats.lossCount;
  const winRate = decided > 0 ? stats.winCount / decided : 0;
  return winRate >= 0.8 && stats.respectAvg > 0;
}

function staleFactor(snapshot: TargetSnapshot, now: number): number {
  const age = now - Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(age) || age <= STALE_MS) return 1;
  const overMinutes = (age - STALE_MS) / 60_000;
  // Floor at 0.5 so a stale-but-ready target is demoted, not buried.
  return Math.max(0.5, 1 - overMinutes / 25);
}

export function scoreTarget({ snapshot, fairFight, pinned, now }: PriorityInput): PriorityResult {
  if (!snapshot) return { score: 0, reasons: [] };

  const readiness = readinessScore(snapshot, now);
  const winnability = winnabilityScore(fairFight);
  const reward = rewardScore(snapshot);
  const freshness = freshnessScore(snapshot, now);

  let score =
    WEIGHTS.readiness * readiness.value +
    WEIGHTS.winnability * winnability.value +
    WEIGHTS.reward * reward.value +
    WEIGHTS.freshness * freshness.value;

  score *= staleFactor(snapshot, now);

  const farm = isReliableFarm(snapshot);
  if (farm) score += FARM_BONUS;
  if (pinned) score += PINNED_BONUS;
  if (snapshot.hitYouBack) score -= HIT_BACK_PENALTY;
  if ((snapshot.hitStats?.hitBackCount ?? 0) >= 2) score -= HITS_BACK_OFTEN_PENALTY;

  const reasons: string[] = [];
  if (readiness.reason) reasons.push(readiness.reason);
  if (winnability.reason) reasons.push(winnability.reason);
  if (reward.reason) reasons.push(reward.reason);
  if (freshness.reason) reasons.push(freshness.reason);
  if (farm) reasons.push("Reliable farm");
  if (snapshot.hitYouBack) reasons.push("Hit you back");
  if ((snapshot.hitStats?.hitBackCount ?? 0) >= 2) reasons.push("Hits back often");
  if (staleFactor(snapshot, now) < 1) reasons.push("Stale reading");

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}
