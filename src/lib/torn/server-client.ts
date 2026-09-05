import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { CONNECTION_COOKIE, readConnectionSession } from "./connection-session";
import { TornClient } from "./client";
import { createOfflineFixtureFetch, isOfflineFixtureKey } from "./offline-fixture";
import { CHAIN_CACHE_SECONDS, MIN_POLL_SECONDS } from "./polling-policy";
import { normalizeTornProfileImageUrl } from "./profile-image";
import { readRememberedConnection, updateRememberedConnectionImage, REMEMBERED_CONNECTION_COOKIE } from "./remembered-connection";

export interface ConfiguredTornConnection {
  client: TornClient;
  tornUserId: number;
  tornUserName: string | null;
  tornUserImageUrl: string | null;
  factionId: number;
  factionName: string | null;
  factionTag: string | null;
}

/**
 * Resolving the client decrypts a stored credential and, in local mode, opens
 * the AppData credential database. A single render calls this from the layout,
 * the page, and every workspace data loader, so the result is memoized for the
 * lifetime of one request instead of repeating that work per caller.
 */
export const getConfiguredTornConnection = cache(async (): Promise<ConfiguredTornConnection | null> => {
  const cookieStore = await cookies();
  const rememberedToken = cookieStore.get(REMEMBERED_CONNECTION_COOKIE)?.value;
  const remembered = await readRememberedConnection(rememberedToken);
  const session = remembered ?? readConnectionSession(cookieStore.get(CONNECTION_COOKIE)?.value);
  const apiKey = session?.apiKey;
  if (!apiKey) return null;
  const offline = isOfflineFixtureKey(apiKey);
  const client = createTornClient(apiKey, offline);

  const tornUserImageUrl = remembered && rememberedToken
    ? await resolveAndBackfillProfileImage(client, rememberedToken, session)
    : session.tornUserImageUrl;

  return {
    tornUserId: session.tornUserId,
    tornUserName: session.tornUserName,
    tornUserImageUrl,
    factionId: session.factionId,
    factionName: session.factionName,
    factionTag: session.factionTag,
    client,
  };
});

/**
 * A remembered (30-day) connection's image is captured once, at initial
 * connect time. Without a backfill, an account that had no Torn avatar yet
 * when it first connected -- or connected before this field existed -- would
 * silently re-fetch the full profile from Torn on every single page load for
 * the rest of its 30-day life instead of just until an avatar is found.
 */
async function resolveAndBackfillProfileImage(
  client: TornClient,
  rememberedToken: string,
  session: { tornUserId: number; tornUserImageUrl: string | null },
): Promise<string | null> {
  if (session.tornUserImageUrl) return session.tornUserImageUrl;
  const details = await client.getMyProfileDetails().catch(() => null);
  if (details?.profile.id !== session.tornUserId) return null;
  const imageUrl = normalizeTornProfileImageUrl(details.profile.image);
  if (imageUrl) void updateRememberedConnectionImage(rememberedToken, imageUrl).catch(() => {});
  return imageUrl;
}

/** Creates an isolated server client for trusted background workers. */
export function createTornClient(apiKey: string, offline = false): TornClient {
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
}

export const getConfiguredTornClient = cache(async (): Promise<TornClient | null> =>
  (await getConfiguredTornConnection())?.client ?? null
);

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
