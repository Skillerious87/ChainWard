import "server-only";

import { createHash } from "node:crypto";
import type { ZodType } from "zod";
import { readLimitedJson, RequestBodyTooLargeError } from "@/lib/security/request-body";
import { TornApiError } from "./errors";
import { CHAIN_CACHE_SECONDS } from "./polling-policy";
import { battleStatsResponseSchema } from "@/lib/members/member-battle-stats";
import { factionPoolOperation } from "./api-pool-policy";
import type { FactionPoolRequest, TornCoordinationContext, TornResponseSnapshot } from "./api-pool-types";
import {
  chainReportResponseSchema,
  chainsResponseSchema,
  factionBasicResponseSchema,
  factionMembersResponseSchema,
  keyInfoResponseSchema,
  ongoingChainResponseSchema,
  tornErrorSchema,
  userAttacksResponseSchema,
  userBasicResponseSchema,
  userBountiesResponseSchema,
  userEventsResponseSchema,
  userProfileByIdResponseSchema,
  userProfileResponseSchema,
  type ChainReportResponse,
  type ChainsResponse,
  type FactionBasicResponse,
  type FactionMembersResponse,
  type KeyInfoResponse,
  type OngoingChainResponse,
  type UserAttacksResponse,
  type UserBasicResponse,
  type UserBountiesResponse,
  type UserEventsResponse,
  type UserProfileByIdResponse,
  type UserProfileResponse,
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
  coordinateRequests?: boolean;
  coordination?: TornCoordinationContext;
  sharedFaction?: {
    factionId: number;
    read: (request: FactionPoolRequest, ownRead: () => Promise<TornResponseSnapshot>) => Promise<TornResponseSnapshot>;
  };
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
const MAX_RESPONSE_BYTES = 8 * 1_024 * 1_024;
const MAX_RETRY_DELAY_MS = 5_000;
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
  private readonly coordinateRequests: boolean;
  private readonly coordination: TornCoordinationContext;
  private readonly sharedFaction: TornClientOptions["sharedFaction"];

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
    this.coordinateRequests = options.coordinateRequests === true && this.dataMode !== "offline";
    this.coordination = { ...options.coordination };
    this.sharedFaction = options.sharedFaction;
    this.keyFingerprint = createHash("sha256")
      .update(options.apiKey)
      .digest("hex");
  }

  async getKeyInfo(options: TornRequestOptions = {}): Promise<KeyInfoResponse> {
    const snapshot = await this.requestWithMeta("/key/info", keyInfoResponseSchema, this.historyCacheMs, {}, options);
    const response = snapshot.value;
    if (this.coordination.ownerId && this.coordination.ownerId !== response.info.user.id) {
      const error = new TornApiError(2, "The Torn credential identity was inconsistent.");
      if (this.coordinateRequests) {
        const { recordTornFailure } = await import("./api-request-budget");
        await recordTornFailure(this.keyFingerprint, this.coordination, error);
      }
      throw error;
    }
    if (this.coordinateRequests) {
      const { identifyTornOwner } = await import("./api-request-budget");
      await identifyTornOwner(this.keyFingerprint, response.info.user.id, undefined, { factionId: response.info.user.faction_id, verifiedAt: snapshot.fetchedAt });
    }
    this.coordination.ownerId = response.info.user.id;
    return response;
  }

  getMyProfile(): Promise<UserBasicResponse> {
    return this.request("/user/basic", userBasicResponseSchema, this.historyCacheMs);
  }

  getMyBattleStats() {
    return this.requestWithMeta("/user/battlestats", battleStatsResponseSchema, 60_000);
  }

  /**
   * Public profile of an arbitrary Torn player, read with the operator's own
   * key — powers the personal Targets list. Cached for 60s, which matches the
   * Targets workspace's ~90s staleness window.
   */
  getUserProfileById(tornUserId: number, options: TornRequestOptions = {}): Promise<{ value: UserProfileByIdResponse; fetchedAt: number }> {
    return this.requestWithMeta(`/user/${tornUserId}`, userProfileByIdResponseSchema, 60_000, { selections: "profile" }, options);
  }

  /**
   * The operator's own recent attack log — powers the Targets "last hit by me"
   * and retaliation flags. Cached briefly; the list only grows as they play.
   */
  getMyAttacks(options: TornRequestOptions = {}): Promise<{ value: UserAttacksResponse; fetchedAt: number }> {
    return this.requestWithMeta("/user/attacks", userAttacksResponseSchema, 45_000, { limit: "100", sort: "DESC" }, options);
  }

  /**
   * Bounties placed on an arbitrary player — powers the Targets bounty badge.
   * Cached far longer than a profile read: bounties change much less often
   * than hospital/travel status, and Torn documents this as a globally
   * cached selection on its own side.
   */
  getUserBounties(tornUserId: number): Promise<{ value: UserBountiesResponse; fetchedAt: number }> {
    return this.requestWithMeta(`/user/${tornUserId}/bounties`, userBountiesResponseSchema, 10 * 60_000);
  }

  /**
   * The key owner's own recent account activity - powers the platform
   * owner's "possible matching transfers" assist on pending licence
   * payments. Never used to approve anything automatically. `sort` is not
   * supported on this selection per Torn's documentation.
   */
  getMyEvents(): Promise<UserEventsResponse> {
    return this.request("/user/events", userEventsResponseSchema, 60_000, { limit: "100" });
  }

  getMyProfileDetails(): Promise<UserProfileResponse> {
    return this.request("/user/profile", userProfileResponseSchema, this.historyCacheMs, {
      striptags: "true",
    });
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
    requestOptions: TornRequestOptions = {},
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
      requestOptions,
    );
  }

  getChainReport(chainId?: number, options: TornRequestOptions & { live?: boolean } = {}): Promise<ChainReportResponse> {
    const path = chainId
      ? `/faction/${chainId}/chainreport`
      : "/faction/chainreport";
    // An explicit ID may be an ongoing chain. Never give its changing totals
    // the fifteen-minute retention used for completed reports.
    return this.request(path, chainReportResponseSchema, chainId && !options.live ? this.historyCacheMs : this.liveCacheMs, {}, options);
  }

  getFactionMembers(factionId?: number, options: TornRequestOptions = {}): Promise<FactionMembersResponse> {
    const path = factionId ? `/faction/${factionId}/members` : "/faction/members";
    return this.request(path, factionMembersResponseSchema, this.liveCacheMs, {
      striptags: "true",
    }, options);
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
    if (this.sharedFaction && factionPoolOperation(path, this.sharedFaction.factionId)) {
      return this.sharedFaction.read(
        { path, query, cacheMs, forceRefresh: options.forceRefresh === true },
        () => this.requestOwnWithMeta(path, schema, cacheMs, query, options),
      ).then((snapshot) => ({ value: schema.parse(snapshot.value), fetchedAt: snapshot.fetchedAt }));
    }
    return this.requestOwnWithMeta(path, schema, cacheMs, query, options);
  }

  private requestOwnWithMeta<T>(
    path: string,
    schema: ZodType<T>,
    cacheMs: number,
    query: Readonly<Record<string, string>>,
    options: TornRequestOptions,
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
    const coordination = { ...this.coordination, verificationRequest: url.pathname.endsWith("/key/info") };
    if (this.coordinateRequests) {
      if (url.origin !== "https://api.torn.com" || !url.pathname.startsWith("/v2/")) throw new Error("Coordinated Torn requests must use the official HTTPS API.");
      const { reserveTornAttempt } = await import("./api-request-budget");
      await reserveTornAttempt(this.keyFingerprint, coordination);
    }
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: "GET",
        headers: {
          Authorization: `ApiKey ${this.apiKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (cause: unknown) {
      if (this.coordinateRequests) {
        const error = new TornApiError(17, "Torn API request failed.");
        const { recordTornFailure } = await import("./api-request-budget");
        await recordTornFailure(this.keyFingerprint, coordination, error);
        throw error;
      }
      if (attempt < 2) {
        await this.sleep(250 * 2 ** attempt);
        return this.fetchWithRetry(url, schema, attempt + 1);
      }
      throw new TornApiError(17, "Torn API request failed.", { cause });
    }

    const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
    let payload: unknown;
    try {
      payload = await readLimitedJson(response, MAX_RESPONSE_BYTES);
    } catch (cause: unknown) {
      if (!response.ok) {
        const error = new TornApiError(response.status === 429 ? 5 : response.status === 503 ? 9 : 17, `Torn API returned HTTP ${response.status}.`, { retryAfterSeconds });
        if (this.coordinateRequests) {
          const { recordTornFailure } = await import("./api-request-budget");
          await recordTornFailure(this.keyFingerprint, coordination, error);
        }
        throw error;
      }
      throw new TornApiError(
        0,
        cause instanceof RequestBodyTooLargeError
          ? "Torn API response exceeded the safe size limit."
          : "Torn API response could not be read.",
        { cause },
      );
    }
    const errorResult = tornErrorSchema.safeParse(payload);
    if (errorResult.success) {
      const apiError = new TornApiError(
        errorResult.data.error.code,
        errorResult.data.error.error,
        { retryAfterSeconds },
      );
      if (this.coordinateRequests) {
        const { recordTornFailure } = await import("./api-request-budget");
        await recordTornFailure(this.keyFingerprint, coordination, apiError);
      }
      if (!this.coordinateRequests && apiError.retryable && attempt < 2 && (retryAfterSeconds ?? 0) <= 5) {
        await this.sleep(retryDelay(response, attempt));
        return this.fetchWithRetry(url, schema, attempt + 1);
      }
      throw apiError;
    }

    if (!response.ok) {
      const error = new TornApiError(response.status === 429 ? 5 : response.status === 503 ? 9 : 17, `Torn API returned HTTP ${response.status}.`, { retryAfterSeconds });
      if (this.coordinateRequests) {
        const { recordTornFailure } = await import("./api-request-budget");
        await recordTornFailure(this.keyFingerprint, coordination, error);
      }
      throw error;
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
  const seconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
  const requestedDelay = seconds === undefined ? 500 * 2 ** attempt : seconds * 1_000;
  return Math.min(MAX_RETRY_DELAY_MS, requestedDelay);
}

export function parseRetryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? Math.max(0, Math.ceil((timestamp - now) / 1_000)) : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
