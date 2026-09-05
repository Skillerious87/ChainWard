import type { ChainWatchSlotLike } from "./chain-watch-schedule";

export interface ChainWatchGap {
  startAt: string;
  endAt: string;
}

/**
 * Uncovered ranges within [nowMs, nowMs + lookAheadMs). A range counts as
 * covered if any slot's window spans it -- every slot always has a primary,
 * so backups don't factor into coverage. Structurally the same sweep as
 * `analyzeRewardCoverage` in `lib/rewards/reward-engine.ts`, over time
 * instead of hit counts.
 */
export function findChainWatchGaps<T extends ChainWatchSlotLike>(
  slots: readonly T[],
  nowMs: number,
  lookAheadMs: number,
): ChainWatchGap[] {
  const windowEndMs = nowMs + lookAheadMs;
  const relevant = slots
    .map((slot) => ({ start: Date.parse(slot.startAt), end: Date.parse(slot.endAt) }))
    .filter((slot) => slot.end > nowMs && slot.start < windowEndMs)
    .toSorted((left, right) => left.start - right.start);

  const gaps: ChainWatchGap[] = [];
  let coveredThrough = nowMs;

  for (const slot of relevant) {
    if (slot.start > coveredThrough) {
      gaps.push({ startAt: new Date(coveredThrough).toISOString(), endAt: new Date(slot.start).toISOString() });
    }
    coveredThrough = Math.max(coveredThrough, slot.end);
  }

  if (coveredThrough < windowEndMs) {
    gaps.push({ startAt: new Date(coveredThrough).toISOString(), endAt: new Date(windowEndMs).toISOString() });
  }

  return gaps;
}
