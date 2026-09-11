import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { isTrustedMutationRequest, mutationDeniedResponse } from "@/lib/security/request-origin";
import { consumeGlobalRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";
import {
  encodeWebauthnChallenge,
  WEBAUTHN_CHALLENGE_COOKIE,
  WEBAUTHN_CHALLENGE_MAX_AGE_SECONDS,
  webauthnChallengeCookieOptions,
} from "@/lib/torn/webauthn-challenge";
import { webauthnRpId } from "@/lib/torn/webauthn-rp";

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return mutationDeniedResponse();
  // Unlike registration, this route needs no session - that's the whole
  // point of a passkey that survives a cleared cookie - so it's now a second
  // unauthenticated entry point and is rate-limited accordingly.
  const requestLimits = [
    consumeRateLimit("webauthn:auth-options:address-burst", request, { limit: 6, windowMs: 60_000 }),
    consumeRateLimit("webauthn:auth-options:address-sustained", request, { limit: 20, windowMs: 15 * 60_000 }),
    consumeGlobalRateLimit("webauthn:auth-options:process", { limit: 60, windowMs: 60_000 }),
  ];
  const denied = Math.max(0, ...requestLimits.filter((result) => !result.allowed).map((result) => result.retryAfterSeconds));
  if (denied) return errorResponse("Too many requests. Wait before trying again.", "RATE_LIMITED", 429, denied);

  const rpID = webauthnRpId();
  if (!rpID) return errorResponse("Passkeys are unavailable until a public origin is configured.", "UNAVAILABLE", 503);

  // No allowCredentials: this is what lets a discoverable/resident passkey
  // surface via conditional UI (autofill) without the server knowing who's
  // asking yet - the assertion that comes back names its own credential.
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });

  const response = NextResponse.json({ options }, { headers: { "cache-control": "no-store" } });
  response.cookies.set(
    WEBAUTHN_CHALLENGE_COOKIE,
    encodeWebauthnChallenge({ challenge: options.challenge, purpose: "authentication" }),
    webauthnChallengeCookieOptions(WEBAUTHN_CHALLENGE_MAX_AGE_SECONDS),
  );
  return response;
}

function errorResponse(message: string, code: string, status: number, retryAfterSeconds?: number) {
  return NextResponse.json(
    { error: message, code },
    { status, headers: { "cache-control": "no-store", ...(retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : {}) } },
  );
}
