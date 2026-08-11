/**
 * How often Chainward may ask Torn for the ongoing chain.
 *
 * Torn's guidance for the `chain` selection is to poll no faster than once
 * every 5 to 30 seconds; going below that risks an API key cooldown or a
 * temporary ban. Everything here is expressed against that floor.
 *
 * The two windows are deliberately different sizes. The cache has to be
 * *shorter* than the poll interval, otherwise a poll can arrive while the
 * previous response is still valid, return that cached copy, and leave the next
 * genuine refresh a further interval away. With both set to ten seconds the app
 * only really heard from Torn every twenty — and because a hit restarts the
 * chain timeout, a reset could sit unnoticed for that whole stretch, which is
 * what made the countdown look out of step with the game.
 */

/** Torn's documented floor for this selection. */
export const MIN_POLL_SECONDS = 5;

/** Cadence while a chain is running, when `timeout` changes on every hit. */
export const ACTIVE_CHAIN_POLL_SECONDS = 10;

/**
 * Chain response cache. Shorter than the active cadence so each poll reaches
 * Torn, but long enough that several open tabs still share one response.
 */
export const CHAIN_CACHE_SECONDS = 5;

/**
 * Clamps a requested cadence to the documented floor. A saved preference, a
 * misconfigured environment variable, or a future caller cannot drive the app
 * into a rate that would put the key at risk.
 */
export function safePollSeconds(requestedSeconds: number): number {
  if (!Number.isFinite(requestedSeconds) || requestedSeconds <= 0) return ACTIVE_CHAIN_POLL_SECONDS;
  return Math.max(MIN_POLL_SECONDS, Math.floor(requestedSeconds));
}

/** The cadence to use for a given chain state. */
export function pollSecondsForChain(chainIsActive: boolean, preferredSeconds: number): number {
  const preferred = safePollSeconds(preferredSeconds);
  return chainIsActive ? Math.min(preferred, ACTIVE_CHAIN_POLL_SECONDS) : preferred;
}
