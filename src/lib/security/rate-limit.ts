import "server-only";

interface RateLimitBucket {
  count: number;
  resetsAt: number;
}

interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

const globalRateLimits = globalThis as typeof globalThis & {
  chainwardRateLimits?: Map<string, RateLimitBucket>;
};

const buckets = globalRateLimits.chainwardRateLimits ??= new Map<string, RateLimitBucket>();

export function consumeRateLimit(scope: string, request: Request, options: RateLimitOptions): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneExpiredBuckets(now);
  const key = `${scope}:${requestAddress(request)}`;
  const current = buckets.get(key);
  if (!current || current.resetsAt <= now) {
    buckets.set(key, { count: 1, resetsAt: now + options.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  return {
    allowed: current.count <= options.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - now) / 1_000)),
  };
}

export function consumeGlobalRateLimit(scope: string, options: RateLimitOptions): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const key = `${scope}:global`;
  const current = buckets.get(key);
  if (!current || current.resetsAt <= now) {
    buckets.set(key, { count: 1, resetsAt: now + options.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  return { allowed: current.count <= options.limit, retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - now) / 1_000)) };
}

function requestAddress(request: Request): string {
  // Proxy headers are only meaningful when the origin is not directly
  // reachable. Defaulting this off prevents a caller rotating an arbitrary
  // x-forwarded-for value to evade the per-address bucket.
  if (process.env.CHAINWARD_TRUST_PROXY_HEADERS?.trim().toLowerCase() !== "true") return "direct-client";
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 100);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || "local").slice(0, 100);
}

function pruneExpiredBuckets(now: number): void {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetsAt <= now) buckets.delete(key);
  }
}
