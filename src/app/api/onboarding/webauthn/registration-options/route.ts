import { createHash } from "node:crypto";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { isTrustedMutationRequest, mutationDeniedResponse } from "@/lib/security/request-origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { currentConnectionScope } from "@/lib/torn/current-connection-scope";
import {
  encodeWebauthnChallenge,
  WEBAUTHN_CHALLENGE_COOKIE,
  WEBAUTHN_CHALLENGE_MAX_AGE_SECONDS,
  webauthnChallengeCookieOptions,
} from "@/lib/torn/webauthn-challenge";
import { listCredentialsForFingerprint } from "@/lib/torn/webauthn-credentials";
import { webauthnRpId } from "@/lib/torn/webauthn-rp";

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return mutationDeniedResponse();
  // Registration only ever follows a real login, so a modest limit is enough
  // to absorb retries without needing the credential-partitioned tier
  // `validate-key` uses for its unauthenticated attempt surface.
  const limit = consumeRateLimit("webauthn:reg-options", request, { limit: 6, windowMs: 60_000 });
  if (!limit.allowed) return errorResponse("Too many requests. Wait before trying again.", "RATE_LIMITED", 429, limit.retryAfterSeconds);

  const scope = await currentConnectionScope();
  if (!scope) return errorResponse("Sign in with your API key first.", "NO_SESSION", 401);

  const rpID = webauthnRpId();
  if (!rpID) return errorResponse("Passkeys are unavailable until a public origin is configured.", "UNAVAILABLE", 503);

  const existing = await listCredentialsForFingerprint(scope.keyFingerprint);
  const options = await generateRegistrationOptions({
    rpName: "Chainward",
    rpID,
    userName: `Torn faction ${scope.tornFactionId}`,
    // Derived from the scope rather than the Torn player ID, so an
    // authenticator's stored user handle never reveals it.
    userID: scopeUserHandle(scope.tornFactionId, scope.keyFingerprint),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
    excludeCredentials: existing.map((credential) => ({ id: credential.credentialId, transports: credential.transports })),
  });

  const response = NextResponse.json({ options }, { headers: { "cache-control": "no-store" } });
  response.cookies.set(
    WEBAUTHN_CHALLENGE_COOKIE,
    encodeWebauthnChallenge({
      challenge: options.challenge,
      purpose: "registration",
      tornFactionId: scope.tornFactionId,
      keyFingerprint: scope.keyFingerprint,
    }),
    webauthnChallengeCookieOptions(WEBAUTHN_CHALLENGE_MAX_AGE_SECONDS),
  );
  return response;
}

function scopeUserHandle(tornFactionId: number, keyFingerprint: string): Uint8Array<ArrayBuffer> {
  // Always backed by a plain heap ArrayBuffer (never shared) - the cast only
  // narrows the phantom buffer-kind type parameter @simplewebauthn expects.
  return new Uint8Array(createHash("sha256").update(`${tornFactionId}:${keyFingerprint}`).digest()) as Uint8Array<ArrayBuffer>;
}

function errorResponse(message: string, code: string, status: number, retryAfterSeconds?: number) {
  return NextResponse.json(
    { error: message, code },
    { status, headers: { "cache-control": "no-store", ...(retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : {}) } },
  );
}
