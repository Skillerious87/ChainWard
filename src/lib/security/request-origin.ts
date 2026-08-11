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
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const allowedOrigins = new Set([requestUrl.origin]);
    if (forwardedHost && (forwardedProtocol === "http" || forwardedProtocol === "https")) {
      allowedOrigins.add(`${forwardedProtocol}://${forwardedHost}`);
    }
    return allowedOrigins.has(originUrl.origin);
  } catch {
    return false;
  }
}

export function mutationDeniedResponse(): Response {
  return Response.json(
    { error: "This request did not originate from the Chainward application." },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}
