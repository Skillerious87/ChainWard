import "server-only";

import { createHash } from "node:crypto";
import type { ZodType } from "zod";
import { TornApiError } from "./errors";
import { CHAIN_CACHE_SECONDS } from "./polling-policy";
import {
  chainReportResponseSchema,
  chainsResponseSchema,
  factionBasicResponseSchema,
  factionMembersResponseSchema,
  keyInfoResponseSchema,
  ongoingChainResponseSchema,
  tornErrorSchema,
  userBasicResponseSchema,
  type ChainReportResponse,
  type ChainsResponse,
  type FactionBasicResponse,
  type FactionMembersResponse,
  type KeyInfoResponse,
  type OngoingChainResponse,
  type UserBasicResponse,
} from "./schemas";

export interface TornClientOptions {
  apiKey: string;
  dataMode?: "torn" | "offline";
  baseUrl?: string;
  comment?: string;
  requestTimeoutMs?: number;
  liveCacheSeconds?: number;
  /**
   * Hit 10 and each later hit reset `timeout`, so this response goes stale
   * faster than other live values and is cached for less time.
   */
  chainCacheSeconds?: number;
  historyCacheSeconds?: number;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface TornRequestOptions {
  forceRefresh?: boolean;
  bypassUpstreamCache?: boolean;
}

interface CacheEntry {
  expiresAt: number;
  /** When Torn actually answered, which is what a countdown must run from. */
  fetchedAt: number;
  value: unknown;
}

const RESPONSE_CACHE_LIMIT = 400;
const responseCache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<unknown>>();

/**
 * The response cache is process-wide and keyed by credential fingerprint, so a
 * long-running server would otherwise retain one entry per key per endpoint for
 * the lifetime of the process. Expired entries are dropped first; if every
 * entry is still live the oldest insertions are evicted.
 */
function rememberResponse(cacheKey: string, entry: CacheEntry): void {
  responseCache.set(cacheKey, entry);
  if (responseCache.size <= RESPONSE_CACHE_LIMIT) return;
  const now = Date.now();
  for (const [key, value] of responseCache) {
    if (value.expiresAt <= now) responseCache.delete(key);
  }
  for (const key of responseCache.keys()) {
    if (responseCache.size <= RESPONSE_CACHE_LIMIT) break;
    responseCache.delete(key);
  }
}

export class TornClient {
  readonly dataMode: "torn" | "offline";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly comment: string;
  private readonly requestTimeoutMs: number;
  private readonly liveCacheMs: number;
  private readonly chainCacheMs: number;
  private readonly historyCacheMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly keyFingerprint: string;
  private currentChainFetchedAt: number | null = null;

  constructor(options: TornClientOptions) {
    if (!options.apiKey.trim()) throw new Error("A Torn API key is required.");
    this.apiKey = options.apiKey;
    this.dataMode = options.dataMode ?? "torn";
    this.baseUrl = (options.baseUrl ?? "https://api.torn.com/v2").replace(/\/$/, "");
    this.comment = options.comment ?? "chainward";
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.liveCacheMs = (options.liveCacheSeconds ?? 30) * 1_000;
    this.chainCacheMs = (options.chainCacheSeconds ?? CHAIN_CACHE_SECONDS) * 1_000;
    this.historyCacheMs = (options.historyCacheSeconds ?? 900) * 1_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.sleep = options.sleep ?? delay;
    this.keyFingerprint = createHash("sha256")
      .update(options.apiKey)
      .digest("hex")
      .slice(0, 16);
  }

  getKeyInfo(): Promise<KeyInfoResponse> {
    return this.request("/key/info", keyInfoResponseSchema, this.historyCacheMs);
  }

  getMyProfile(): Promise<UserBasicResponse> {
    return this.request("/user/basic", userBasicResponseSchema, this.historyCacheMs);
  }

  getFactionBasic(factionId?: number, options: TornRequestOptions = {}): Promise<FactionBasicResponse> {
    const path = factionId ? `/faction/${factionId}/basic` : "/faction/basic";
    return this.request(path, factionBasicResponseSchema, this.liveCacheMs, {}, options);
  }

  async getCurrentChain(factionId?: number, options: TornRequestOptions = {}): Promise<OngoingChainResponse> {
    const path = factionId ? `/faction/${factionId}/chain` : "/faction/chain";
    const { value, fetchedAt } = await this.requestWithMeta(path, ongoingChainResponseSchema, this.chainCacheMs, {}, options);
    this.currentChainFetchedAt = fetchedAt;
    return value;
  }

  /**
   * Milliseconds at which the chain response now in hand was actually returned
   * by Torn. A cached response is up to `liveCacheSeconds` old, so timing the
   * chain countdown from "now" restarts it on every page load.
   */
  getCurrentChainFetchedAt(): number | null {
    return this.currentChainFetchedAt;
  }

  getCompletedChains(
    factionId?: number,
    options: { from?: number; to?: number; limit?: number } = {},
  ): Promise<ChainsResponse> {
    const path = factionId ? `/faction/${factionId}/chains` : "/faction/chains";
    return this.request(
      path,
      chainsResponseSchema,
      this.historyCacheMs,
      {
        sort: "DESC",
        ...(options.from === undefined ? {} : { from: String(options.from) }),
        ...(options.to === undefined ? {} : { to: String(options.to) }),
        ...(options.limit === undefined ? {} : { limit: String(options.limit) }),
      },
    );
  }

  getChainReport(chainId?: number): Promise<ChainReportResponse> {
    const path = chainId
      ? `/faction/${chainId}/chainreport`
      : "/faction/chainreport";
    return this.request(path, chainReportResponseSchema, chainId ? this.historyCacheMs : this.liveCacheMs);
  }

  getFactionMembers(factionId?: number): Promise<FactionMembersResponse> {
    const path = factionId ? `/faction/${factionId}/members` : "/faction/members";
    return this.request(path, factionMembersResponseSchema, this.liveCacheMs, {
      striptags: "true",
    });
  }

  private request<T>(
    path: string,
    schema: ZodType<T>,
    cacheMs: number,
    query: Readonly<Record<string, string>> = {},
    options: TornRequestOptions = {},
  ): Promise<T> {
    return this.requestWithMeta(path, schema, cacheMs, query, options).then((result) => result.value);
  }

  private requestWithMeta<T>(
    path: string,
    schema: ZodType<T>,
    cacheMs: number,
    query: Readonly<Record<string, string>> = {},
    options: TornRequestOptions = {},
  ): Promise<{ value: T; fetchedAt: number }> {
    const canonicalUrl = new URL(`${this.baseUrl}${path}`);
    canonicalUrl.searchParams.set("comment", this.comment);
    for (const [name, value] of Object.entries(query)) {
      canonicalUrl.searchParams.set(name, value);
    }

    const cacheKey = `${this.keyFingerprint}:${canonicalUrl.toString()}`;
    const cached = responseCache.get(cacheKey);
    if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
      return Promise.resolve({ value: cached.value as T, fetchedAt: cached.fetchedAt });
    }

    const pendingKey = options.forceRefresh ? `${cacheKey}:refresh` : cacheKey;
    const pending = pendingRequests.get(pendingKey);
    if (pending) return pending as Promise<{ value: T; fetchedAt: number }>;

    const requestUrl = new URL(canonicalUrl);
    if (options.bypassUpstreamCache) {
      requestUrl.searchParams.set("timestamp", String(Math.floor(Date.now() / 1_000)));
    }

    const promise = this.fetchWithRetry(requestUrl, schema, 0)
      .then((value) => {
        const fetchedAt = Date.now();
        rememberResponse(cacheKey, { value, expiresAt: fetchedAt + cacheMs, fetchedAt });
        return { value, fetchedAt };
      })
      .finally(() => pendingRequests.delete(pendingKey));

    pendingRequests.set(pendingKey, promise);
    return promise;
  }


  private async fetchWithRetry<T>(
    url: URL,
    schema: ZodType<T>,
    attempt: number,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: "GET",
        headers: {
          Authorization: `ApiKey ${this.apiKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (cause: unknown) {
      if (attempt < 2) {
        await this.sleep(250 * 2 ** attempt);
        return this.fetchWithRetry(url, schema, attempt + 1);
      }
      throw new TornApiError(17, "Torn API request failed.", { cause });
    }

    const payload: unknown = await response.json().catch(() => null);
    const errorResult = tornErrorSchema.safeParse(payload);
    if (errorResult.success) {
      const apiError = new TornApiError(
        errorResult.data.error.code,
        errorResult.data.error.error,
      );
      if (apiError.retryable && attempt < 2) {
        await this.sleep(retryDelay(response, attempt));
        return this.fetchWithRetry(url, schema, attempt + 1);
      }
      throw apiError;
    }

    if (!response.ok) {
      throw new TornApiError(17, `Torn API returned HTTP ${response.status}.`);
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new TornApiError(0, "Torn API response validation failed.", {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
  return Number.isFinite(seconds) ? seconds * 1_000 : 500 * 2 ** attempt;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
