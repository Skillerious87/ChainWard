import "server-only";

import { cookies } from "next/headers";
import { CONNECTION_COOKIE, readConnectionSession } from "./connection-session";
import { TornClient } from "./client";
import { readRememberedConnection, REMEMBERED_CONNECTION_COOKIE } from "./remembered-connection";

export async function getConfiguredTornClient(): Promise<TornClient | null> {
  const cookieStore = await cookies();
  const remembered = await readRememberedConnection(cookieStore.get(REMEMBERED_CONNECTION_COOKIE)?.value);
  const session = remembered ?? readConnectionSession(cookieStore.get(CONNECTION_COOKIE)?.value);
  const apiKey = session?.apiKey ?? process.env.TORN_API_KEY?.trim();
  if (!apiKey) return null;
  return new TornClient({
    apiKey,
    baseUrl: process.env.TORN_API_BASE_URL,
    comment: process.env.TORN_API_COMMENT,
    requestTimeoutMs: positiveInteger(process.env.TORN_REQUEST_TIMEOUT_MS, 10_000),
    liveCacheSeconds: positiveInteger(process.env.TORN_LIVE_CACHE_SECONDS, 30),
    historyCacheSeconds: positiveInteger(process.env.TORN_HISTORY_CACHE_SECONDS, 60),
  });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
