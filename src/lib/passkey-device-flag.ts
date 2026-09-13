"use client";

/**
 * A platform passkey lives in *this device's* credential store - a passkey
 * enrolled on a desktop is invisible to a phone and vice versa, even for the
 * same Torn key. The server's `hasWebauthnCredential` only says whether
 * *some* device has one, so it can't gate the enrollment offer or the
 * explicit unlock button on its own. These device-local flags - set once a
 * passkey genuinely works *here*, via enrollment (from the post-login offer
 * or Settings) or a successful sign-in - are what actually decide that.
 */
function passkeyReadyKey(playerId: number): string {
  return `chainward-passkey-ready-${playerId}`;
}

export function isPasskeyReadyOnThisDevice(playerId: number): boolean {
  try { return localStorage.getItem(passkeyReadyKey(playerId)) === "1"; } catch { return false; }
}

/** Player-independent: whether *any* profile has ever finished enrollment on this device. */
const DEVICE_HAS_PASSKEY_KEY = "chainward-passkey-ready-device";

/**
 * Mirrors `DEVICE_HAS_PASSKEY_KEY` in a plain (non-httpOnly) cookie so the
 * marketing homepage's server-side redirect can see it without a client
 * round trip - the localStorage flag alone isn't visible during that page's
 * server render. Holds no secret, just a same-device UX hint, so it doesn't
 * need httpOnly/Secure treatment. Left in place if the device's last passkey
 * is later removed (a stale cookie only means the homepage redirect fires
 * one time too many, straight to the perfectly normal key-entry screen).
 */
const DEVICE_HAS_PASSKEY_COOKIE = "chainward_passkey_device";
const DEVICE_HAS_PASSKEY_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export function hasAnyPasskeyEnrolledOnThisDevice(): boolean {
  try { return localStorage.getItem(DEVICE_HAS_PASSKEY_KEY) === "1"; } catch { return false; }
}

/**
 * The player-independent half of `markPasskeyReadyOnThisDevice` - callable
 * from contexts (like Settings) that don't have the player ID on hand, since
 * that's only needed for the per-player "don't re-offer enrollment" flag,
 * not for the device-wide gate the explicit unlock button and the homepage
 * redirect both read.
 */
export function markDeviceHasPasskey(): void {
  try { localStorage.setItem(DEVICE_HAS_PASSKEY_KEY, "1"); } catch { /* private browsing - the button just doesn't appear next time */ }
  try {
    document.cookie = `${DEVICE_HAS_PASSKEY_COOKIE}=1; path=/; max-age=${DEVICE_HAS_PASSKEY_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
  } catch { /* best-effort - only gates a same-device convenience redirect */ }
}

export function markPasskeyReadyOnThisDevice(playerId: number): void {
  try { localStorage.setItem(passkeyReadyKey(playerId), "1"); } catch { /* private browsing - the offer just reappears next time */ }
  markDeviceHasPasskey();
}

function passkeySkipKey(playerId: number): string {
  return `chainward-passkey-skip-${playerId}`;
}

export function hasSkippedPasskeyOffer(playerId: number): boolean {
  try { return localStorage.getItem(passkeySkipKey(playerId)) === "1"; } catch { return false; }
}

export function skipPasskeyOffer(playerId: number): void {
  try { localStorage.setItem(passkeySkipKey(playerId), "1"); } catch { /* private browsing - the prompt just reappears next time */ }
}
