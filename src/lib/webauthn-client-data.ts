/**
 * Decodes the base64url `clientDataJSON` a WebAuthn ceremony returns, purely
 * for diagnostics. When Android's Credential Manager brokers a WebView
 * passkey request through Digital Asset Links, the `origin` it embeds can
 * differ from what a plain browser would send - this is how that gets
 * surfaced without guessing.
 */
export function decodeClientDataOrigin(clientDataJSON: string): { origin: string; type: string } | null {
  try {
    const base64 = clientDataJSON.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const parsed: unknown = JSON.parse(atob(padded));
    if (!parsed || typeof parsed !== "object") return null;
    const origin = "origin" in parsed && typeof parsed.origin === "string" ? parsed.origin : null;
    const type = "type" in parsed && typeof parsed.type === "string" ? parsed.type : null;
    if (!origin || !type) return null;
    return { origin, type };
  } catch {
    return null;
  }
}
