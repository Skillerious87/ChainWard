/**
 * Chain countdown model.
 *
 * The previous design sent an absolute deadline computed on Torn's clock and
 * projected it against the browser's `Date.now()`. That silently assumes the
 * two machines agree on the time. They do not: a browser clock can be minutes
 * out, and the measured offset only arrived after the first poll — so a page
 * load counted down from the wrong instant and then jumped the moment the
 * offset was learned. That is the "counts down, then leaps up on refresh".
 *
 * This model never compares two machines' clocks. Two ideas do the work:
 *
 *   1. Transmit a *duration*, not a timestamp. Torn reports seconds remaining,
 *      and the server measures how stale that reading is entirely within its
 *      own clock. No cross-machine comparison exists to be wrong.
 *
 *   2. Project it with a *monotonic* clock. `performance.now()` cannot jump,
 *      go backwards, or be changed by the user or by daylight saving, which is
 *      exactly what is wanted for measuring elapsed time. Wall clocks are for
 *      naming instants; monotonic clocks are for measuring durations.
 *
 * Reconciliation then keeps the display honest without letting it twitch. See
 * `reconcileAnchor` for the rules.
 */

/** A remaining duration, pinned to a reading of the monotonic clock. */
export interface CountdownAnchor {
  remainingMs: number;
  atPerf: number;
}

/**
 * Disagreement below this is measurement noise, not news.
 *
 * Torn's countdown has one-second resolution, Torn may answer from its own
 * cache, and the round trip varies — so two consecutive syncs differ by a
 * second or so even when nothing has happened.
 */
export const NOISE_TOLERANCE_MS = 1_500;

/**
 * A jump larger than this is a real event: a hit restarts Torn's window, which
 * adds far more than a second. Below it, an increase is treated as noise, so
 * the display never counts upward without cause.
 */
export const RESET_THRESHOLD_MS = 5_000;

/**
 * Corrections between the two thresholds are applied a quarter at a time, so a
 * genuine drift converges over a few syncs instead of snapping. Slewing rather
 * than stepping is the same reason NTP disciplines a clock gradually.
 */
export const SLEW_FRACTION = 0.25;

export function createAnchor(remainingMs: number, atPerf: number): CountdownAnchor {
  return { remainingMs: Math.max(0, remainingMs), atPerf };
}

/**
 * Builds an anchor from a server reading.
 *
 * @param reportedRemainingMs Seconds remaining as Torn reported them, in ms.
 * @param dataAgeMs How long ago Torn answered, measured on the server's own clock.
 * @param transitMs Time between the server writing the payload and the client
 *   reading it: half a measured round trip for a fetch, or the elapsed page
 *   load for a server-rendered payload.
 */
export function anchorFromReading(reportedRemainingMs: number, dataAgeMs: number, transitMs: number, atPerf: number): CountdownAnchor {
  return createAnchor(reportedRemainingMs - Math.max(0, dataAgeMs) - Math.max(0, transitMs), atPerf);
}

/** Remaining milliseconds at a given monotonic reading. */
export function project(anchor: CountdownAnchor, nowPerf: number): number {
  return Math.max(0, anchor.remainingMs - Math.max(0, nowPerf - anchor.atPerf));
}

/**
 * Folds a new reading into the running countdown.
 *
 * The rules, in order:
 *
 *   - A large increase is a genuine window reset, so it is adopted at once.
 *   - A small increase is ignored. Running marginally fast is invisible and
 *     safe; a timer that ticks upward reads as broken.
 *   - A small decrease is ignored as noise for the same reason.
 *   - A larger decrease is real drift and is corrected, but only a fraction at
 *     a time, so the number never visibly jumps.
 */
export function reconcileAnchor(anchor: CountdownAnchor, incomingRemainingMs: number, nowPerf: number): CountdownAnchor {
  const projected = project(anchor, nowPerf);
  const incoming = Math.max(0, incomingRemainingMs);
  const delta = incoming - projected;

  if (delta >= RESET_THRESHOLD_MS) return createAnchor(incoming, nowPerf);
  if (delta >= -NOISE_TOLERANCE_MS) return createAnchor(projected, nowPerf);

  // Running behind reality: converge downward without a visible step.
  return createAnchor(projected + delta * SLEW_FRACTION, nowPerf);
}

/**
 * Whole seconds for display. Ceiling, so the label reaches zero exactly at the
 * deadline and each second is shown for its full duration.
 */
export function displaySeconds(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1_000));
}
