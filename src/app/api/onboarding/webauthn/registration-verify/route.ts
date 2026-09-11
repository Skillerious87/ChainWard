import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { z } from "zod";
import { readLimitedJson, RequestBodyTooLargeError } from "@/lib/security/request-body";
import { isTrustedMutationRequest, mutationDeniedResponse } from "@/lib/security/request-origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { currentConnectionScope } from "@/lib/torn/current-connection-scope";
import { decodeWebauthnChallenge, WEBAUTHN_CHALLENGE_COOKIE, webauthnChallengeCookieOptions } from "@/lib/torn/webauthn-challenge";
import { registerWebauthnCredential } from "@/lib/torn/webauthn-credentials";
import { webauthnOrigin, webauthnRpId } from "@/lib/torn/webauthn-rp";

const requestSchema = z.object({
  // The full shape is a nested object produced by @simplewebauthn/browser;
  // verifyRegistrationResponse does the real structural validation below.
  response: z.record(z.string(), z.unknown()),
  deviceLabel: z.string().trim().max(60).optional(),
});

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return mutationDeniedResponse();
  const limit = consumeRateLimit("webauthn:reg-verify", request, { limit: 6, windowMs: 60_000 });
  if (!limit.allowed) return errorResponse("Too many requests. Wait before trying again.", "RATE_LIMITED", 429, limit.retryAfterSeconds);

  const scope = await currentConnectionScope();
  if (!scope) return errorResponse("Sign in with your API key first.", "NO_SESSION", 401);

  let input: unknown;
  try { input = await readLimitedJson(request, 16_384); }
  catch (error) { return errorResponse(error instanceof RequestBodyTooLargeError ? error.message : "The request could not be read.", "INVALID_FORMAT", 413); }
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return errorResponse("The passkey response was malformed.", "INVALID_FORMAT", 400);

  const cookieStore = await cookies();
  const challenge = decodeWebauthnChallenge(cookieStore.get(WEBAUTHN_CHALLENGE_COOKIE)?.value, "registration");
  // An expired/missing challenge fails the first check; a challenge minted
  // for a different session fails the second - a stolen or replayed
  // challenge cookie can never be paired with someone else's scope.
  if (!challenge || challenge.tornFactionId !== scope.tornFactionId || challenge.keyFingerprint !== scope.keyFingerprint) {
    return clearChallenge(errorResponse("This passkey setup has expired. Start again.", "CHALLENGE_EXPIRED", 400));
  }

  const origin = webauthnOrigin();
  const rpID = webauthnRpId();
  if (!origin || !rpID) return errorResponse("Passkeys are unavailable until a public origin is configured.", "UNAVAILABLE", 503);

  let verified = false;
  let credential: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] } | undefined;
  try {
    const verification = await verifyRegistrationResponse({
      response: parsed.data.response as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin.origin,
      expectedRPID: rpID,
    });
    verified = verification.verified;
    credential = verification.registrationInfo?.credential;
  } catch {
    verified = false;
  }
  if (!verified || !credential) return clearChallenge(errorResponse("The passkey could not be verified.", "VERIFICATION_FAILED", 400));

  await registerWebauthnCredential({
    credentialId: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: credential.transports,
    deviceLabel: parsed.data.deviceLabel,
    tornFactionId: scope.tornFactionId,
    keyFingerprint: scope.keyFingerprint,
    apiKey: scope.apiKey,
  });

  return clearChallenge(NextResponse.json({ registered: true }, { headers: { "cache-control": "no-store" } }));
}

function clearChallenge(response: NextResponse): NextResponse {
  response.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, "", webauthnChallengeCookieOptions(0));
  return response;
}

function errorResponse(message: string, code: string, status: number, retryAfterSeconds?: number) {
  return NextResponse.json(
    { error: message, code },
    { status, headers: { "cache-control": "no-store", ...(retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : {}) } },
  );
}
