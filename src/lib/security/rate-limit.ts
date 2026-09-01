import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";

interface RateLimitBucket {
  tokens: number;
  updatedAt: number;
  expiresAt: number;
}

export interface RateLimitOptions {
  /** Maximum burst size and the number of tokens restored per window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAfterSeconds: number;
}

const globalRateLimits = globalThis as typeof globalThis & {
  chainwardTokenBuckets?: Map<string, RateLimitBucket>;
  chainwardConcurrencySlots?: Map<string, number>;
};

const buckets = globalRateLimits.chainwardTokenBuckets ??= new Map<string, RateLimitBucket>();
const concurrencySlots = globalRateLimits.chainwardConcurrencySlots ??= new Map<string, number>();
const MAX_BUCKETS = 10_000;

/**
 * Limits a request by a trusted client address. Proxy-derived addresses are
 * ignored unless the deployment explicitly opts into them.
 */
export function consumeRateLimit(scope: string, request: Request, options: RateLimitOptions): RateLimitResult {
  return consumePartitionRateLimit(scope, requestAddress(request), options);
}

/** Limits a named operation across the current application instance. */
export function consumeGlobalRateLimit(scope: string, options: RateLimitOptions): RateLimitResult {
  return consumePartitionRateLimit(scope, "global", options);
}

/**
 * Limits an authenticated actor, credential fingerprint, faction, or other
 * stable server-verified partition. The raw partition is hashed and is never
 * retained in the bucket map.
 */
export function consumePartitionRateLimit(scope: string, partition: string | number, options: RateLimitOptions): RateLimitResult {
  validateOptions(options);
  const now = Date.now();
  pruneExpiredBuckets(now);
  const key = bucketKey(scope, String(partition));
  const refillPerMillisecond = options.limit / options.windowMs;
  const current = buckets.get(key);
  const available = current
    ? Math.min(options.limit, current.tokens + Math.max(0, now - current.updatedAt) * refillPerMillisecond)
    : options.limit;
  const allowed = available >= 1;
  const tokens = allowed ? available - 1 : available;
  const millisecondsUntilFull = Math.ceil((options.limit - tokens) / refillPerMillisecond);

  buckets.set(key, {
    tokens,
    updatedAt: now,
    // Once a bucket is full, deleting it is equivalent to retaining it and
    // bounds memory without shortening an active penalty.
    expiresAt: now + Math.max(1, millisecondsUntilFull),
  });

  return {
    allowed,
    limit: options.limit,
    remaining: Math.max(0, Math.floor(tokens)),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((1 - tokens) / refillPerMillisecond / 1_000)),
    resetAfterSeconds: Math.max(0, Math.ceil(millisecondsUntilFull / 1_000)),
  };
}

/**
 * Reserves an in-process slot for work whose simultaneous execution is itself
 * costly. The returned release function is idempotent and must be called from
 * a `finally` block.
 */
export function acquireConcurrencySlot(scope: string, partition: string | number, limit: number): (() => void) | null {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("A concurrency limit must be a positive integer.");
  const key = bucketKey(`concurrency:${scope}`, String(partition));
  const active = concurrencySlots.get(key) ?? 0;
  if (active >= limit) return null;
  concurrencySlots.set(key, active + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (concurrencySlots.get(key) ?? 1) - 1;
    if (remaining <= 0) concurrencySlots.delete(key);
    else concurrencySlots.set(key, remaining);
  };
}

function bucketKey(scope: string, partition: string): string {
  return createHash("sha256").update(scope).update("\0").update(partition).digest("base64url");
}

function requestAddress(request: Request): string {
  // Proxy headers are caller-controlled if the Next.js origin is reachable.
  // Enable this only when a trusted proxy overwrites them and blocks direct
  // origin traffic. Otherwise all direct/local traffic intentionally shares a
  // conservative bucket, backed by route-wide limits on costly operations.
  if (process.env.CHAINWARD_TRUST_PROXY_HEADERS?.trim().toLowerCase() !== "true") return "direct-client";

  const realIp = validIp(request.headers.get("x-real-ip"));
  if (realIp) return realIp;

  const forwardedHeader = request.headers.get("x-forwarded-for");
  if (!forwardedHeader || forwardedHeader.length > 1_024) return "unknown-proxy-client";
  const forwardedIp = validIp(forwardedHeader.split(",", 1)[0]);
  return forwardedIp ?? "unknown-proxy-client";
}

function validIp(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 100 || !isIP(candidate)) return null;
  return candidate.toLowerCase();
}

function validateOptions(options: RateLimitOptions): void {
  if (!Number.isSafeInteger(options.limit) || options.limit <= 0) throw new Error("A rate limit must be a positive integer.");
  if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) throw new Error("A rate-limit window must be positive.");
}

function pruneExpiredBuckets(now: number): void {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    if (bucket.expiresAt <= now) buckets.delete(key);
  }
  if (buckets.size < MAX_BUCKETS) return;
  let overflow = buckets.size - MAX_BUCKETS + 1;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    overflow -= 1;
    if (overflow === 0) break;
  }
}
