import "server-only";

/**
 * Mirrors the client-set `chainward-passkey-ready-device` flag from
 * src/lib/passkey-device-flag.ts as a plain (non-httpOnly) cookie the
 * homepage's proxy redirect can read server-side. Set here rather than
 * relying solely on the client's own `document.cookie` write: verified
 * directly against a real device that Capacitor's Android WebView doesn't
 * reliably persist a JS-set cookie to its on-disk store, while a cookie
 * arriving via a `Set-Cookie` response header - the same mechanism the
 * existing session cookie already relies on - does. A successful passkey
 * ceremony (registration or authentication) is definitive proof this device
 * has one, so both routes set it here.
 */
export const PASSKEY_DEVICE_COOKIE = "chainward_passkey_device";
const PASSKEY_DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export function passkeyDeviceCookieOptions() {
  return {
    httpOnly: false,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PASSKEY_DEVICE_COOKIE_MAX_AGE_SECONDS,
  };
}
