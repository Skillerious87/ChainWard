/**
 * How often Chainward may ask Torn for the ongoing chain.
 *
 * Torn currently documents a per-user ceiling of 100 requests per minute, not
 * a selection-specific cadence. During an active chain, Chainward makes one
 * fresh chain request every five seconds: 12 per minute in one visible tab,
 * comfortably below that ceiling while keeping hit detection responsive.
 *
 * Active requests use Torn's documented `timestamp` cache bypass and skip the
 * local response cache. The normal five-second cache still coalesces ordinary
 * reads and simultaneous requests from multiple parts of the app.
 */

/** Chainward's conservative application floor for this selection. */
export const MIN_POLL_SECONDS = 5;

/** Cadence while a chain is running, when hit 10 and later hits reset timeout. */
export const ACTIVE_CHAIN_POLL_SECONDS = 5;

/** Normal chain response cache; explicit active-chain refreshes bypass it. */
export const CHAIN_CACHE_SECONDS = 5;

/**
 * Clamps a requested cadence to the application floor. A saved preference, a
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
