import "server-only";

import { deploymentOrigin } from "@/lib/metadata/public-origin";

const DEV_FALLBACK_ORIGIN = "http://localhost:3000";

/** Mirrors `layout.tsx`'s localhost fallback for `metadataBase` outside production. */
export function webauthnOrigin(): URL | undefined {
  return deploymentOrigin() ?? (process.env.NODE_ENV === "production" ? undefined : new URL(DEV_FALLBACK_ORIGIN));
}

export function webauthnRpId(): string | undefined {
  return webauthnOrigin()?.hostname;
}

/**
 * SHA-256 certificate fingerprints of every Android build allowed to broker
 * passkeys for this origin - must mirror `sha256_cert_fingerprints` in
 * `public/.well-known/assetlinks.json`. Update both together (e.g. once a
 * release keystore exists alongside the debug one).
 */
const ANDROID_APP_CERT_SHA256_FINGERPRINTS = [
  "D9:93:CD:C4:06:EF:3B:F4:59:B2:86:4D:F5:5D:C5:EF:D3:17:19:C6:5D:FE:56:D9:39:FB:5A:40:61:68:5E:30",
];

/**
 * Android's Credential Manager, brokering a passkey ceremony for the
 * Capacitor app through Digital Asset Links, sets `clientDataJSON.origin` to
 * this `android:apk-key-hash:<...>` form identifying the calling app's own
 * signing certificate - not the site's https origin a plain browser would
 * send. Both are legitimate for the same relying party once Digital Asset
 * Links has vouched for the app, so verification must accept either.
 */
function androidAppOrigin(sha256Fingerprint: string): string {
  const hex = sha256Fingerprint.replace(/:/g, "");
  return `android:apk-key-hash:${Buffer.from(hex, "hex").toString("base64url")}`;
}

/** Every origin a WebAuthn ceremony for this app may legitimately arrive from. */
export function webauthnExpectedOrigins(): string[] | undefined {
  const origin = webauthnOrigin();
  if (!origin) return undefined;
  return [origin.origin, ...ANDROID_APP_CERT_SHA256_FINGERPRINTS.map(androidAppOrigin)];
}
