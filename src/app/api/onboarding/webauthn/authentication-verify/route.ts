import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { z } from "zod";
import { readLimitedJson, RequestBodyTooLargeError } from "@/lib/security/request-body";
import { isTrustedMutationRequest, mutationDeniedResponse } from "@/lib/security/request-origin";
import { consumeGlobalRateLimit, consumePartitionRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";
import { respondWithEstablishedConnection } from "@/lib/torn/connection-response";
import { MissingTornSelectionsError, validateTornConnection } from "@/lib/torn/connection-service";
import { TornApiError, userFacingTornError } from "@/lib/torn/errors";
import { decodeWebauthnChallenge, WEBAUTHN_CHALLENGE_COOKIE, webauthnChallengeCookieOptions } from "@/lib/torn/webauthn-challenge";
import {
  deleteWebauthnCredentialsForFingerprint,
  resolveWebauthnCandidate,
  updateWebauthnCounter,
} from "@/lib/torn/webauthn-credentials";
import { webauthnOrigin, webauthnRpId } from "@/lib/torn/webauthn-rp";

const requestSchema = z.object({
  response: z.object({ id: z.string().min(1).max(1024) }).catchall(z.unknown()),
});

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return mutationDeniedResponse();
  // No session is required to reach this route - that's the recovery path a
  // cleared cookie needs - so it's rate-limited at least as strictly as
  // validate-key's own unauthenticated entry point.
  const requestLimits = [
    consumeRateLimit("webauthn:auth-verify:address-burst", request, { limit: 4, windowMs: 60_000 }),
    consumeRateLimit("webauthn:auth-verify:address-sustained", request, { limit: 10, windowMs: 15 * 60_000 }),
    consumeGlobalRateLimit("webauthn:auth-verify:process", { limit: 40, windowMs: 10 * 60_000 }),
  ];
  const denied = Math.max(0, ...requestLimits.filter((result) => !result.allowed).map((result) => result.retryAfterSeconds));
  if (denied) return errorResponse("Too many attempts. Wait before trying again.", "RATE_LIMITED", 429, denied);

  let input: unknown;
  try { input = await readLimitedJson(request, 16_384); }
  catch (error) { return errorResponse(error instanceof RequestBodyTooLargeError ? error.message : "The request could not be read.", "INVALID_FORMAT", 413); }
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return errorResponse("The passkey response was malformed.", "INVALID_FORMAT", 400);

  const credentialLimit = consumePartitionRateLimit("webauthn:auth-verify:credential", parsed.data.response.id, { limit: 6, windowMs: 15 * 60_000 });
  if (!credentialLimit.allowed) return errorResponse("This passkey has been checked too frequently. Wait before trying again.", "RATE_LIMITED", 429, credentialLimit.retryAfterSeconds);

  // Scope comes entirely from the stored row keyed by this credential ID -
  // never from anything else in the request - so a valid signature for one
  // credential can't be paired with another credential's scope.
  const candidate = await resolveWebauthnCandidate(parsed.data.response.id);
  if (!candidate) return errorResponse("This passkey is no longer recognized. Sign in with your API key instead.", "CREDENTIAL_REVOKED", 401);

  const cookieStore = await cookies();
  const challenge = decodeWebauthnChallenge(cookieStore.get(WEBAUTHN_CHALLENGE_COOKIE)?.value, "authentication");
  if (!challenge) return clearChallenge(errorResponse("This sign-in attempt has expired. Try again.", "CHALLENGE_EXPIRED", 400));

  const origin = webauthnOrigin();
  const rpID = webauthnRpId();
  if (!origin || !rpID) return errorResponse("Passkeys are unavailable until a public origin is configured.", "UNAVAILABLE", 503);

  let verified = false;
  let newCounter = candidate.counter;
  try {
    const verification = await verifyAuthenticationResponse({
      response: parsed.data.response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin.origin,
      expectedRPID: rpID,
      // Always backed by a plain heap ArrayBuffer (never shared) - the cast
      // only narrows the phantom buffer-kind type parameter @simplewebauthn expects.
      credential: { id: candidate.credentialId, publicKey: candidate.publicKey as Uint8Array<ArrayBuffer>, counter: candidate.counter },
    });
    verified = verification.verified;
    newCounter = verification.authenticationInfo.newCounter;
  } catch {
    verified = false;
  }
  if (!verified) return clearChallenge(errorResponse("The passkey could not be verified.", "VERIFICATION_FAILED", 400));
  await updateWebauthnCounter(candidate.credentialId, newCounter);

  try {
    // Never trust that a passkey which once worked still does - the
    // underlying Torn key may have been rotated or paused since. This
    // re-validates it exactly as a fresh key paste would.
    const connection = await validateTornConnection(candidate.apiKey, {
      baseUrl: process.env.TORN_API_BASE_URL,
      comment: process.env.TORN_API_COMMENT,
      requestTimeoutMs: parsePositiveInteger(process.env.TORN_REQUEST_TIMEOUT_MS, 10_000),
      liveCacheSeconds: parsePositiveInteger(process.env.TORN_LIVE_CACHE_SECONDS, 30),
      historyCacheSeconds: parsePositiveInteger(process.env.TORN_HISTORY_CACHE_SECONDS, 60),
    });
    return clearChallenge(await respondWithEstablishedConnection(candidate.apiKey, connection, { remember: true }));
  } catch (error: unknown) {
    if (error instanceof MissingTornSelectionsError) {
      return clearChallenge(errorResponse(`This custom key is missing: ${error.missingSelections.join(", ")}.`, "MISSING_SELECTIONS", 200));
    }
    if (error instanceof TornApiError) {
      if (error.category === "INVALID_KEY") {
        // The key itself is gone for good, so every passkey scoped to it is
        // equally dead - a paused key (temporary) is left alone instead.
        await deleteWebauthnCredentialsForFingerprint(candidate.keyFingerprint);
        return clearChallenge(errorResponse("This passkey's Torn key no longer exists. Sign in with your API key instead.", "CREDENTIAL_REVOKED", 200));
      }
      const status = error.category === "KEY_PAUSED" || error.category === "INSUFFICIENT_PERMISSION" ? 200 : 502;
      return clearChallenge(errorResponse(userFacingTornError(error), error.category, status));
    }
    return clearChallenge(errorResponse("The Torn connection could not be validated safely.", "VALIDATION_FAILED", 400));
  }
}

function clearChallenge(response: NextResponse): NextResponse {
  response.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, "", webauthnChallengeCookieOptions(0));
  return response;
}

function errorResponse(message: string, code: string, status: number, retryAfterSeconds?: number) {
  return NextResponse.json(
    { connected: false, error: message, code },
    { status, headers: { "cache-control": "no-store", ...(retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : {}) } },
  );
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
