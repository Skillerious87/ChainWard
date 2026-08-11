"use client";

/**
 * Chain deadlines arrive expressed on Torn's clock. A browser whose system
 * time is wrong — which is common, and can be minutes out — would otherwise
 * count down to the wrong instant no matter how precise the deadline is.
 *
 * Every telemetry fetch is timed, and the round trip is halved to estimate when
 * the payload was built relative to this machine's clock. The residual error is
 * therefore half the network latency, typically well under a tenth of a second,
 * rather than the whole of the local clock's drift.
 */

const CLOCK_EVENT = "chainward:clock";

/**
 * Below this, a difference is noise rather than news.
 *
 * Three independent sources jitter by up to a second each: Torn's `Date` header
 * has one-second resolution, Torn may answer from its own short cache, and the
 * network round trip varies. Chasing every one of those made the displayed
 * countdown jump on each sync. Nothing smaller than this threshold is a real
 * change, so it is ignored rather than smoothed — smoothing still moved the
 * clock, which is what produced the flicker.
 */
export const CLOCK_TOLERANCE_MS = 2_000;

/** A round trip longer than this makes the midpoint estimate unreliable. */
const MAX_USABLE_ROUND_TRIP_MS = 3_000;

let offsetMs = 0;
let sampled = false;

/**
 * Record a timing sample.
 *
 * @param clockAtMs Torn-clock milliseconds reported in the payload.
 * @param requestStartedMs Local clock immediately before the request.
 * @param requestEndedMs Local clock immediately after the response arrived.
 */
export function recordClockSample(clockAtMs: number | undefined, requestStartedMs: number, requestEndedMs: number): void {
  if (typeof clockAtMs !== "number" || !Number.isFinite(clockAtMs)) return;
  const roundTrip = Math.max(0, requestEndedMs - requestStartedMs);
  if (roundTrip > MAX_USABLE_ROUND_TRIP_MS) return;
  // Assume the response was built halfway through the round trip.
  const localAtBuild = requestStartedMs + roundTrip / 2;
  const sample = clockAtMs - localAtBuild;
  if (Math.abs(sample) > 24 * 60 * 60 * 1_000) return;

  if (sampled && Math.abs(sample - offsetMs) < CLOCK_TOLERANCE_MS) return;
  offsetMs = sample;
  sampled = true;
  window.dispatchEvent(new CustomEvent<number>(CLOCK_EVENT, { detail: offsetMs }));
}

/**
 * Whether a freshly reported deadline should replace the one being counted
 * down. A hit restarts Torn's window, which moves the deadline by far more than
 * the tolerance; anything smaller is measurement noise and holding the existing
 * deadline keeps the countdown monotonic.
 */
export function reconcileDeadline(heldMs: number, incomingMs: number): number {
  if (heldMs <= 0) return incomingMs;
  if (incomingMs <= 0) return incomingMs;
  return Math.abs(incomingMs - heldMs) >= CLOCK_TOLERANCE_MS ? incomingMs : heldMs;
}

/**
 * Keeps the displayed remainder from stepping backwards. A countdown that
 * briefly counts up reads as broken even when the underlying number is
 * defensible, so a small upward correction is suppressed while a genuine reset
 * is adopted immediately.
 */
export function stabiliseRemaining(currentMs: number, rawMs: number): number {
  if (rawMs <= currentMs) return rawMs;
  return rawMs - currentMs >= CLOCK_TOLERANCE_MS ? rawMs : currentMs;
}

/** Current time on Torn's clock, in milliseconds. */
export function tornNow(): number {
  return Date.now() + offsetMs;
}

export function tornClockOffsetMs(): number {
  return offsetMs;
}

export function observeTornClock(listener: () => void): () => void {
  window.addEventListener(CLOCK_EVENT, listener);
  return () => window.removeEventListener(CLOCK_EVENT, listener);
}
