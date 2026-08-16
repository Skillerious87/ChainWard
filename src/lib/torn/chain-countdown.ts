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

/** The chain identity and hit count attached to a countdown reading. */
export interface ChainCountdownReading {
  anchor: CountdownAnchor;
  key: string;
  current: number;
}

/** Hit 10 completes warm-up; it and every later successful hit reset timeout. */
export const FIRST_RESETTING_HIT = 10;

/**
 * Disagreement below this is measurement noise, not news.
 *
 * Torn's countdown has one-second resolution, Torn may answer from its own
 * cache, and the round trip varies — so two consecutive syncs differ by a
 * second or so even when nothing has happened.
 */
export const NOISE_TOLERANCE_MS = 1_500;

/**
 * A confirmed hit that adds at least this much time is a real reset. The hit
 * count is the confirmation; the size only prevents sub-second response noise
 * around a very early hit from making the display tick upward.
 */
export const RESET_THRESHOLD_MS = 5_000;

/**
 * Observed behaviour of the live endpoint, measured against a real faction:
 *
 *   elapsed   timeout
 *      0s        76
 *     10s        76
 *     20s        76
 *     30s        45     <- one step of 31s
 *     40s        45
 *     50s        45
 *
 * Torn serves the chain from a roughly thirty second cache. The body is a
 * snapshot that only moves at the cache boundary, while the `Date` header
 * advances in real time — so the header cannot be used to age the body.
 *
 * The consequence drives the whole design: a reading can be up to a full cache
 * window stale, and how stale is unknowable and different every time. A
 * reported figure is therefore an **upper bound** on the time actually left,
 * never an exact measure, and the honest countdown is the lowest bound seen so
 * far. That also errs the safe way for a chain timer: better to believe there
 * is less time than there really is.
 */
export const TORN_CACHE_WINDOW_SECONDS = 30;

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
 *   - A large increase is adopted only when a higher chain count confirms a
 *     hit at or beyond hit 10. Duration alone cannot distinguish a reset from
 *     the same cached response arriving again.
 *   - Every other increase is ignored. Because each reading is an upper bound,
 *     an uncorroborated increase carries no information — it may only mean the
 *     response is staler than the bound already held.
 *   - A small decrease is ignored as noise, so the display does not twitch.
 *   - A larger decrease is adopted in full. It is not drift to be eased in: a
 *     lower bound is strictly better information, and holding the higher figure
 *     would overstate the time left, which is the dangerous direction.
 *
 * In steady state these corrections are small. The previous reading has already
 * counted down by the time the next arrives, so the two bounds are usually
 * within a second or two of each other.
 */
export function reconcileAnchor(
  anchor: CountdownAnchor,
  incomingRemainingMs: number,
  nowPerf: number,
  resetConfirmed = false,
): CountdownAnchor {
  const projected = project(anchor, nowPerf);
  const incoming = Math.max(0, incomingRemainingMs);
  const delta = incoming - projected;

  // A repeated cached response keeps reporting the old, larger duration while
  // the local projection counts down. Its delta will eventually be enormous,
  // so duration alone can never prove that a hit occurred. Only a higher Torn
  // chain count may authorize an upward reset.
  if (resetConfirmed && delta >= RESET_THRESHOLD_MS) return createAnchor(incoming, nowPerf);
  if (delta >= -NOISE_TOLERANCE_MS) return createAnchor(projected, nowPerf);

  return createAnchor(incoming, nowPerf);
}

/**
 * Reconciles Torn's hit count and timeout as one atomic reading.
 *
 * The hit count is the only reliable proof that a reset happened. Hits 1-9
 * share the initial warm-up timer, while hit 10 and every higher hit restart
 * the five-minute window. Keeping that rule here prevents a repeated or
 * out-of-order response from moving the clock in the wrong direction.
 */
export function reconcileChainReading(
  previous: ChainCountdownReading,
  incoming: ChainCountdownReading,
  nowPerf: number,
): ChainCountdownReading {
  if (incoming.key !== previous.key) return incoming;

  if (incoming.current < previous.current) {
    return {
      anchor: createAnchor(project(previous.anchor, nowPerf), nowPerf),
      key: previous.key,
      current: previous.current,
    };
  }

  const resetConfirmed = incoming.current > previous.current && incoming.current >= FIRST_RESETTING_HIT;
  return {
    anchor: reconcileAnchor(previous.anchor, incoming.anchor.remainingMs, nowPerf, resetConfirmed),
    key: incoming.key,
    current: incoming.current,
  };
}

/**
 * Whole seconds for display. Ceiling, so the label reaches zero exactly at the
 * deadline and each second is shown for its full duration.
 */
export function displaySeconds(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1_000));
}
