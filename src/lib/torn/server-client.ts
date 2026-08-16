import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { CONNECTION_COOKIE, readConnectionSession } from "./connection-session";
import { TornClient } from "./client";
import { createOfflineFixtureFetch, isOfflineFixtureKey } from "./offline-fixture";
import { CHAIN_CACHE_SECONDS, MIN_POLL_SECONDS } from "./polling-policy";
import { readRememberedConnection, REMEMBERED_CONNECTION_COOKIE } from "./remembered-connection";

/**
 * Resolving the client decrypts a stored credential and, in local mode, opens
 * the AppData credential database. A single render calls this from the layout,
 * the page, and every workspace data loader, so the result is memoized for the
 * lifetime of one request instead of repeating that work per caller.
 */
export const getConfiguredTornClient = cache(async (): Promise<TornClient | null> => {
  const cookieStore = await cookies();
  const remembered = await readRememberedConnection(cookieStore.get(REMEMBERED_CONNECTION_COOKIE)?.value);
  const session = remembered ?? readConnectionSession(cookieStore.get(CONNECTION_COOKIE)?.value);
  const apiKey = session?.apiKey;
  if (!apiKey) return null;
  const offline = isOfflineFixtureKey(apiKey);
  return new TornClient({
    apiKey,
    dataMode: offline ? "offline" : "torn",
    baseUrl: process.env.TORN_API_BASE_URL,
    comment: process.env.TORN_API_COMMENT,
    requestTimeoutMs: positiveInteger(process.env.TORN_REQUEST_TIMEOUT_MS, 10_000),
    liveCacheSeconds: positiveInteger(process.env.TORN_LIVE_CACHE_SECONDS, 30),
    // Held at or above the application's conservative floor even if configured lower.
    chainCacheSeconds: Math.max(MIN_POLL_SECONDS, positiveInteger(process.env.TORN_CHAIN_CACHE_SECONDS, CHAIN_CACHE_SECONDS)),
    historyCacheSeconds: positiveInteger(process.env.TORN_HISTORY_CACHE_SECONDS, 600),
    ...(offline ? { fetchImplementation: createOfflineFixtureFetch(apiKey) } : {}),
  });
});

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
