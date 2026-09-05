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
  refreshProfileImage: () => Promise<string | null>;
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

  let profileImagePromise: Promise<string | null> | undefined;

  return {
    tornUserId: session.tornUserId,
    tornUserName: session.tornUserName,
    tornUserImageUrl: session.tornUserImageUrl,
    factionId: session.factionId,
    factionName: session.factionName,
    factionTag: session.factionTag,
    client,
    // Only the rendered shell needs this request. Telemetry and permission
    // checks must remain independent of avatar API availability.
    refreshProfileImage: () => profileImagePromise ??= resolveProfileImage(client, session, remembered ? rememberedToken : undefined),
  };
});

/**
 * Refresh images for both session types through the Torn client's shared,
 * bounded profile cache. A URL saved at login can later be replaced or removed
 * on Torn; trusting it for the entire session leaves the avatar stuck.
 * Keep the saved image when Torn is unavailable and persist successful changes
 * before the request ends so hosted runtimes cannot abandon the write.
 */
async function resolveProfileImage(
  client: TornClient,
  session: { tornUserId: number; tornUserImageUrl: string | null },
  rememberedToken?: string,
): Promise<string | null> {
  const storedImageUrl = normalizeTornProfileImageUrl(session.tornUserImageUrl);
  const details = await client.getMyProfileDetails().catch(() => null);
  if (details?.profile.id !== session.tornUserId) return storedImageUrl;
  const imageUrl = normalizeTornProfileImageUrl(details.profile.image);
  if (rememberedToken && imageUrl !== session.tornUserImageUrl) {
    await updateRememberedConnectionImage(rememberedToken, imageUrl).catch(() => {});
  }
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
