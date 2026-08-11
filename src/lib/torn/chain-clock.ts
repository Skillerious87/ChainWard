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
  // Assume the response was built halfway through the round trip.
  const localAtBuild = requestStartedMs + roundTrip / 2;
  const sample = clockAtMs - localAtBuild;
  if (Math.abs(sample) > 24 * 60 * 60 * 1_000) return;
  // Smooth once a baseline exists, so one slow response cannot jerk the timer.
  offsetMs = sampled ? offsetMs + (sample - offsetMs) * 0.5 : sample;
  sampled = true;
  window.dispatchEvent(new CustomEvent<number>(CLOCK_EVENT, { detail: offsetMs }));
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
