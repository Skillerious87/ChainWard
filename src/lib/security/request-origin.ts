import "server-only";

/**
 * Mutating route handlers accept same-origin browser traffic. Requests without
 * browser origin metadata remain usable by local test clients and scripts.
 */
export function isTrustedMutationRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const allowedOrigins = new Set([requestUrl.origin, ...configuredMutationOrigins()]);
    // Next may normalise request.url to localhost while a local client used
    // 127.0.0.1. The actual Host header is browser-controlled (unlike the
    // forwarded variants), so it is the correct same-origin comparison here.
    const host = request.headers.get("host")?.split(",")[0]?.trim();
    if (host) {
      try { allowedOrigins.add(new URL(`${requestUrl.protocol}//${host}`).origin); }
      catch { /* A malformed Host never expands the allowlist. */ }
    }
    return allowedOrigins.has(originUrl.origin);
  } catch {
    return false;
  }
}

/**
 * Reverse-proxy headers are caller-controlled when the application can be
 * reached directly, so they cannot safely define an accepted origin. Hosted
 * deployments behind a proxy declare their public origins explicitly instead.
 */
function configuredMutationOrigins(): string[] {
  return (process.env.CHAINWARD_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? [url.origin] : [];
      } catch {
        return [];
      }
    });
}

export function mutationDeniedResponse(): Response {
  return Response.json(
    { error: "This request did not originate from the Chainward application." },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}
