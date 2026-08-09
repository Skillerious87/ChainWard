import { NextResponse } from "next/server";
import { z } from "zod";
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
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse("Enter the 16-character API key from Torn Settings, not the key name or your password.", "INVALID_FORMAT", 400);
  }

  try {
    const connection = await validateTornConnection(parsed.data.apiKey, {
      baseUrl: process.env.TORN_API_BASE_URL,
      comment: process.env.TORN_API_COMMENT,
      requestTimeoutMs: parsePositiveInteger(process.env.TORN_REQUEST_TIMEOUT_MS, 10_000),
      liveCacheSeconds: parsePositiveInteger(process.env.TORN_LIVE_CACHE_SECONDS, 30),
      historyCacheSeconds: parsePositiveInteger(process.env.TORN_HISTORY_CACHE_SECONDS, 60),
    });
    const remembered = parsed.data.remember
      ? await createRememberedConnection(parsed.data.apiKey, connection)
      : null;
    const response = NextResponse.json({
      ...connection,
      connected: true,
      session: {
        remembered: Boolean(remembered),
        expiresAt: new Date(remembered?.expiresAt ?? Date.now() + CONNECTION_MAX_AGE_SECONDS * 1_000).toISOString(),
      },
    }, {
      headers: { "cache-control": "no-store" },
    });
    if (remembered) {
      response.cookies.set(REMEMBERED_CONNECTION_COOKIE, remembered.token, connectionCookieOptions(REMEMBERED_CONNECTION_MAX_AGE_SECONDS));
      response.cookies.set(CONNECTION_COOKIE, "", connectionCookieOptions(0));
    } else {
      response.cookies.set(CONNECTION_COOKIE, createConnectionSession(parsed.data.apiKey, connection.player.id, connection.faction.id), connectionCookieOptions(CONNECTION_MAX_AGE_SECONDS));
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
    return errorResponse(error instanceof Error ? error.message : "The Torn connection could not be validated.", "VALIDATION_FAILED", 400);
  }
}

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json({ connected: false, error: message, code }, { status, headers: { "cache-control": "no-store" } });
}

function normalizeApiKey(value: string): string {
  const trimmed = value.trim();
  const hasMatchingQuotes = trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")));
  return hasMatchingQuotes ? trimmed.slice(1, -1).trim() : trimmed;
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
