const TORN_PROFILE_IMAGE_HOST = "profileimages.torn.com";
const LOG_PREFIX = "[chainward:profile-image-rejected]";

/**
 * Torn's documented schema is just "a string or null," with no format spec,
 * so this accepts the shapes a CDN reference can reasonably arrive in --
 * protocol-relative, scheme-less, or plain `http:` -- rather than only the
 * exact `https://profileimages.torn.com/...` shape, and upgrades to https.
 * The hostname allowlist is what actually matters for safety; the scheme
 * variations are just real-world tolerance around it.
 */
export function normalizeTornProfileImageUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const candidates = [
    trimmed,
    trimmed.startsWith("//") ? `https:${trimmed}` : null,
    /^https?:\/\//i.test(trimmed) ? null : `https://${trimmed.replace(/^\/+/, "")}`,
  ].filter((candidate): candidate is string => candidate !== null);

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.hostname !== TORN_PROFILE_IMAGE_HOST || (url.protocol !== "https:" && url.protocol !== "http:")) continue;
      url.protocol = "https:";
      return url.toString();
    } catch {
      // Try the next candidate shape.
    }
  }

  // A real, non-empty value that never resolved to a Torn CDN URL is worth a
  // trace -- otherwise "Torn has no avatar" and "we rejected a real one" are
  // indistinguishable from the caller's point of view. Not a secret: this is
  // a public CDN reference, never a credential.
  console.warn(LOG_PREFIX, JSON.stringify({ value: trimmed.slice(0, 300) }));
  return null;
}
