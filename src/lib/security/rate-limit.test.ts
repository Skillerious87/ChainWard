import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireConcurrencySlot, consumeGlobalRateLimit, consumePartitionRateLimit, consumeRateLimit } from "./rate-limit";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("request rate limiting", () => {
  it("denies calls after a scope consumes its burst", () => {
    const scope = `test-global-${crypto.randomUUID()}`;
    expect(consumeGlobalRateLimit(scope, { limit: 2, windowMs: 60_000 }).allowed).toBe(true);
    expect(consumeGlobalRateLimit(scope, { limit: 2, windowMs: 60_000 }).allowed).toBe(true);
    const denied = consumeGlobalRateLimit(scope, { limit: 2, windowMs: 60_000 });
    expect(denied).toMatchObject({ allowed: false, limit: 2, remaining: 0 });
    expect(denied.retryAfterSeconds).toBe(30);
  });

  it("refills tokens continuously instead of opening a fixed-window boundary", () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const scope = `test-refill-${crypto.randomUUID()}`;
    const options = { limit: 2, windowMs: 60_000 };
    expect(consumeGlobalRateLimit(scope, options).allowed).toBe(true);
    expect(consumeGlobalRateLimit(scope, options).allowed).toBe(true);
    expect(consumeGlobalRateLimit(scope, options).allowed).toBe(false);
    now += 29_999;
    expect(consumeGlobalRateLimit(scope, options).allowed).toBe(false);
    now += 1;
    expect(consumeGlobalRateLimit(scope, options).allowed).toBe(true);
  });

  it("keeps server-verified partitions independent", () => {
    const scope = `test-partition-${crypto.randomUUID()}`;
    const options = { limit: 1, windowMs: 60_000 };
    expect(consumePartitionRateLimit(scope, 123, options).allowed).toBe(true);
    expect(consumePartitionRateLimit(scope, 456, options).allowed).toBe(true);
    expect(consumePartitionRateLimit(scope, 123, options).allowed).toBe(false);
  });

  it("bounds concurrent work and releases slots idempotently", () => {
    const scope = `test-concurrency-${crypto.randomUUID()}`;
    const first = acquireConcurrencySlot(scope, 123, 1);
    expect(first).toBeTypeOf("function");
    expect(acquireConcurrencySlot(scope, 123, 1)).toBeNull();
    const other = acquireConcurrencySlot(scope, 456, 1);
    expect(other).toBeTypeOf("function");
    first?.();
    first?.();
    const reacquired = acquireConcurrencySlot(scope, 123, 1);
    expect(reacquired).toBeTypeOf("function");
    other?.();
    reacquired?.();
  });

  it("does not trust caller-controlled proxy addresses by default", () => {
    const previous = process.env.CHAINWARD_TRUST_PROXY_HEADERS;
    delete process.env.CHAINWARD_TRUST_PROXY_HEADERS;
    try {
      const scope = `test-address-${crypto.randomUUID()}`;
      const first = new Request("http://localhost/test", { headers: { "x-forwarded-for": "192.0.2.1" } });
      const second = new Request("http://localhost/test", { headers: { "x-forwarded-for": "198.51.100.2" } });
      expect(consumeRateLimit(scope, first, { limit: 1, windowMs: 60_000 }).allowed).toBe(true);
      expect(consumeRateLimit(scope, second, { limit: 1, windowMs: 60_000 }).allowed).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.CHAINWARD_TRUST_PROXY_HEADERS;
      else process.env.CHAINWARD_TRUST_PROXY_HEADERS = previous;
    }
  });

  it("accepts only valid proxy IP addresses when proxy trust is enabled", () => {
    const previous = process.env.CHAINWARD_TRUST_PROXY_HEADERS;
    process.env.CHAINWARD_TRUST_PROXY_HEADERS = "true";
    try {
      const scope = `test-proxy-${crypto.randomUUID()}`;
      const first = new Request("http://localhost/test", { headers: { "x-real-ip": "not-an-ip", "x-forwarded-for": "192.0.2.1, 10.0.0.1" } });
      const same = new Request("http://localhost/test", { headers: { "x-real-ip": "still-invalid", "x-forwarded-for": "192.0.2.1" } });
      const other = new Request("http://localhost/test", { headers: { "x-real-ip": "198.51.100.2" } });
      expect(consumeRateLimit(scope, first, { limit: 1, windowMs: 60_000 }).allowed).toBe(true);
      expect(consumeRateLimit(scope, same, { limit: 1, windowMs: 60_000 }).allowed).toBe(false);
      expect(consumeRateLimit(scope, other, { limit: 1, windowMs: 60_000 }).allowed).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.CHAINWARD_TRUST_PROXY_HEADERS;
      else process.env.CHAINWARD_TRUST_PROXY_HEADERS = previous;
    }
  });
});
