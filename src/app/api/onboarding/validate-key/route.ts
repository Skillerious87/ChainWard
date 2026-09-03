import { NextResponse } from "next/server";
import { z } from "zod";
import {
  reportUnexpectedOnboardingValidationFailure,
  type OnboardingValidationStage,
} from "@/lib/diagnostics/onboarding-validation";
import { readLimitedJson, RequestBodyTooLargeError } from "@/lib/security/request-body";
import { isTrustedMutationRequest, mutationDeniedResponse } from "@/lib/security/request-origin";
import { consumeGlobalRateLimit, consumePartitionRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";
import { registerFactionAccessRequest } from "@/lib/auth/faction-access-store";
import { MissingTornSelectionsError, validateTornConnection } from "@/lib/torn/connection-service";
import { CONNECTION_COOKIE, CONNECTION_MAX_AGE_SECONDS, createConnectionSession } from "@/lib/torn/connection-session";
import { TornApiError, userFacingTornError } from "@/lib/torn/errors";
import { createRememberedConnection, REMEMBERED_CONNECTION_COOKIE, REMEMBERED_CONNECTION_MAX_AGE_SECONDS } from "@/lib/torn/remembered-connection";

const requestSchema = z.object({
  apiKey: z.string()
    .transform(normalizeApiKey)
    .pipe(z.string().regex(/^[A-Za-z0-9]{16}$/, "Torn API keys contain exactly 16 letters and numbers.")),
  remember: z.boolean().optional().default(true),
});

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return mutationDeniedResponse();
  // A short burst absorbs accidental double-submits, while the longer buckets
  // prevent a public caller from using Chainward to test credentials or expose
  // the server's Torn-facing IP to a flood of invalid-key requests.
  const requestLimits = [
    consumeRateLimit("onboarding-key:address-burst", request, { limit: 4, windowMs: 60_000 }),
    consumeRateLimit("onboarding-key:address-sustained", request, { limit: 10, windowMs: 15 * 60_000 }),
    consumeGlobalRateLimit("onboarding-key:process-burst", { limit: 10, windowMs: 60_000 }),
    consumeGlobalRateLimit("onboarding-key:process-sustained", { limit: 40, windowMs: 10 * 60_000 }),
  ];
  const deniedRequestLimit = retryAfter(requestLimits);
  if (deniedRequestLimit) return errorResponse("Too many connection attempts. Wait before trying again.", "RATE_LIMITED", 429, deniedRequestLimit);
  let input: unknown;
  try { input = await readLimitedJson(request, 2_048); }
  catch (error) { return errorResponse(error instanceof RequestBodyTooLargeError ? error.message : "The request could not be read.", "INVALID_FORMAT", 413); }
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return errorResponse("Enter the 16-character API key from Torn Settings, not the key name or your password.", "INVALID_FORMAT", 400);
  }

  const credentialLimit = consumePartitionRateLimit("onboarding-key:credential", parsed.data.apiKey, { limit: 4, windowMs: 15 * 60_000 });
  if (!credentialLimit.allowed) {
    return errorResponse("This API key has been checked too frequently. Wait before trying again.", "RATE_LIMITED", 429, credentialLimit.retryAfterSeconds);
  }

  let stage: OnboardingValidationStage = "torn-api-validation";
  try {
    const connection = await validateTornConnection(parsed.data.apiKey, {
      baseUrl: process.env.TORN_API_BASE_URL,
      comment: process.env.TORN_API_COMMENT,
      requestTimeoutMs: parsePositiveInteger(process.env.TORN_REQUEST_TIMEOUT_MS, 10_000),
      liveCacheSeconds: parsePositiveInteger(process.env.TORN_LIVE_CACHE_SECONDS, 30),
      historyCacheSeconds: parsePositiveInteger(process.env.TORN_HISTORY_CACHE_SECONDS, 60),
    });
    stage = "access-request";
    await registerFactionAccessRequest(connection);
    let session:
      | { kind: "remembered"; value: Awaited<ReturnType<typeof createRememberedConnection>> }
      | { kind: "temporary"; value: string };
    if (parsed.data.remember) {
      stage = "remembered-connection";
      session = {
        kind: "remembered",
        value: await createRememberedConnection(parsed.data.apiKey, connection),
      };
    } else {
      stage = "temporary-session";
      session = {
        kind: "temporary",
        value: createConnectionSession(parsed.data.apiKey, connection.player.id, connection.faction.id, {
          tornUserName: connection.player.name,
          factionName: connection.faction.name,
          factionTag: connection.faction.tag,
        }),
      };
    }

    stage = "response-construction";
    const response = NextResponse.json({
      ...connection,
      connected: true,
      session: {
        remembered: session.kind === "remembered",
        expiresAt: new Date(session.kind === "remembered" ? session.value.expiresAt : Date.now() + CONNECTION_MAX_AGE_SECONDS * 1_000).toISOString(),
      },
    }, {
      headers: { "cache-control": "no-store" },
    });
    if (session.kind === "remembered") {
      response.cookies.set(REMEMBERED_CONNECTION_COOKIE, session.value.token, connectionCookieOptions(REMEMBERED_CONNECTION_MAX_AGE_SECONDS));
      response.cookies.set(CONNECTION_COOKIE, "", connectionCookieOptions(0));
    } else {
      response.cookies.set(CONNECTION_COOKIE, session.value, connectionCookieOptions(CONNECTION_MAX_AGE_SECONDS));
      response.cookies.set(REMEMBERED_CONNECTION_COOKIE, "", connectionCookieOptions(0));
    }
    return response;
  } catch (error: unknown) {
    if (error instanceof MissingTornSelectionsError) {
      return errorResponse(`This custom key is missing: ${error.missingSelections.join(", ")}.`, "MISSING_SELECTIONS", 200);
    }
    if (error instanceof TornApiError) {
      // A rejected credential is an expected form-validation outcome, not a
      // failed request to a protected Chainward resource. Keep those results
      // out of the browser's failed-resource console while preserving a
      // machine-readable reason. Upstream service failures remain HTTP errors.
      const status = error.category === "INVALID_KEY"
        || error.category === "KEY_PAUSED"
        || error.category === "INSUFFICIENT_PERMISSION" ? 200 : 502;
      return errorResponse(userFacingTornError(error), error.category, status);
    }
    const diagnosticId = reportUnexpectedOnboardingValidationFailure({
      apiKey: parsed.data.apiKey,
      error,
      rememberRequested: parsed.data.remember,
      stage,
    });
    return errorResponse(
      `The Torn connection could not be validated safely. Diagnostic reference: ${diagnosticId}.`,
      "VALIDATION_FAILED",
      400,
      undefined,
      diagnosticId,
    );
  }
}

function errorResponse(message: string, code: string, status: number, retryAfterSeconds?: number, diagnosticId?: string) {
  return NextResponse.json(
    { connected: false, error: message, code, ...(diagnosticId ? { diagnosticId } : {}) },
    {
      status,
      headers: {
        "cache-control": "no-store",
        ...(retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : {}),
        ...(diagnosticId ? { "x-chainward-diagnostic-id": diagnosticId } : {}),
      },
    },
  );
}

function normalizeApiKey(value: string): string {
  const trimmed = value.trim();
  const hasMatchingQuotes = trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")));
  return hasMatchingQuotes ? trimmed.slice(1, -1).trim() : trimmed;
}

function retryAfter(results: Array<{ allowed: boolean; retryAfterSeconds: number }>): number {
  return Math.max(0, ...results.filter((result) => !result.allowed).map((result) => result.retryAfterSeconds));
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function connectionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
    priority: "high" as const,
  };
}
