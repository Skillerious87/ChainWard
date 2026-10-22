import { describe, expect, it, vi } from "vitest";
import { parseRetryAfterSeconds, TornClient } from "./client";
import { TornApiError, userFacingTornError } from "./errors";

describe("TornClient", () => {
  const sharedChain = { chain: { id: 12, current: 42, max: 100, timeout: 210, modifier: 1, cooldown: 0, start: 1_700_000_000, end: 0 } };

  it("coalesces concurrent shared reads without retaining authorization across later calls", async () => {
    const read = vi.fn(async () => ({ value: sharedChain, fetchedAt: Date.now() }));
    const client = new TornClient({ apiKey: "shared-inflight", sharedFaction: { factionId: 51393, read } });
    const results = await Promise.all([client.getCurrentChain(), client.getCurrentChain(), client.getCurrentChain()]);
    expect(read).toHaveBeenCalledOnce();
    expect(results.every((result) => result.chain.current === 42)).toBe(true);
    await client.getCurrentChain();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("releases failed shared reads so the next attempt can recover", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("Broker unavailable")).mockResolvedValue({ value: sharedChain, fetchedAt: Date.now() });
    const client = new TornClient({ apiKey: "shared-recovery", sharedFaction: { factionId: 51393, read } });
    await expect(client.getCurrentChain()).rejects.toThrow("Broker unavailable");
    await expect(client.getCurrentChain()).resolves.toEqual(sharedChain);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps explicit shared refreshes separate from cached reads", async () => {
    const read = vi.fn(async () => ({ value: sharedChain, fetchedAt: Date.now() }));
    const client = new TornClient({ apiKey: "shared-freshness", sharedFaction: { factionId: 51393, read } });
    await Promise.all([client.getCurrentChain(), client.getCurrentChain(undefined, { forceRefresh: true, bypassUpstreamCache: true })]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each(["profile", "attacks"] as const)("refreshes %s immediately after an attack without reusing the normal cache", async (kind) => {
    const payload = kind === "profile" ? { profile: { id: 123, name: "Target", status: { state: "Okay" } } } : { attacks: [] };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(payload));
    const client = new TornClient({ apiKey: `fresh-target-${kind}`, fetchImplementation: fetchMock });
    const read = (fresh = false) => {
      const options = fresh ? { forceRefresh: true, bypassUpstreamCache: true } : {};
      return kind === "profile" ? client.getUserProfileById(123, options) : client.getMyAttacks(options);
    };
    await read();
    await read();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await read(true);
    await read();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get("timestamp")).toMatch(/^\d+$/);
  });

  it("retrieves the current profile image from the public profile endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      profile: {
        id: 3_212_954,
        name: "Skillerious",
        image: "https://profileimages.torn.com/skillerious.gif?v=2",
      },
    }));
    const client = new TornClient({ apiKey: "profile-image-test", fetchImplementation: fetchMock });

    await expect(client.getMyProfileDetails()).resolves.toMatchObject({
      profile: { image: "https://profileimages.torn.com/skillerious.gif?v=2" },
    });
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe("/v2/user/profile");
  });

  it("sends the API key only in the authorization header", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        chain: {
          id: 12,
          current: 42,
          max: 100,
          timeout: 210,
          modifier: 1,
          cooldown: 0,
          start: 1_700_000_000,
          end: 0,
        },
      }),
    );
    const client = new TornClient({
      apiKey: "do-not-leak-this-key",
      fetchImplementation: fetchMock,
    });

    await client.getCurrentChain();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).not.toContain("do-not-leak-this-key");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "ApiKey do-not-leak-this-key",
    );
  });

  it("maps paused keys to a useful non-retryable error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: { code: 18, error: "Key paused" } }),
    );
    const client = new TornClient({
      apiKey: "paused-key",
      fetchImplementation: fetchMock,
    });

    await expect(client.getKeyInfo()).rejects.toMatchObject({
      category: "KEY_PAUSED",
      retryable: false,
    });
  });

  it("returns a long upstream cooldown without sleeping or retrying early", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const limited = () => Response.json(
      { error: { code: 5, error: "Too many requests" } },
      { status: 429, headers: { "retry-after": "86400" } },
    );
    const client = new TornClient({
      apiKey: "retry-delay-cap",
      fetchImplementation: vi.fn<typeof fetch>().mockImplementation(async () => limited()),
      sleep,
    });

    await expect(client.getKeyInfo()).rejects.toMatchObject({ category: "RATE_LIMITED", retryAfterSeconds: 86400 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("understands seconds and HTTP-date cooldowns", () => {
    const now = Date.UTC(2026, 9, 20, 12);
    expect(parseRetryAfterSeconds("120", now)).toBe(120);
    expect(parseRetryAfterSeconds("Tue, 20 Oct 2026 12:02:00 GMT", now)).toBe(120);
    expect(parseRetryAfterSeconds("invalid", now)).toBeUndefined();
  });

  it("handles an HTML rate-limit response without requiring Torn JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("<h1>Rate limited</h1>", { status: 429, headers: { "retry-after": "90" } }));
    const client = new TornClient({ apiKey: "html-limit-test", fetchImplementation: fetchMock });
    await expect(client.getKeyInfo()).rejects.toMatchObject({ code: 5, retryAfterSeconds: 90 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves an IP-block error even when the HTTP status is 429", async () => {
    const client = new TornClient({ apiKey: "ip-limit-test", fetchImplementation: vi.fn(async () => Response.json({ error: { code: 8, error: "IP blocked" } }, { status: 429 })) });
    await expect(client.getKeyInfo()).rejects.toMatchObject({ code: 8, retryable: false });
  });

  it("rejects an oversized upstream payload before buffering it", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", {
      headers: { "content-length": String(9 * 1_024 * 1_024) },
    }));
    const client = new TornClient({ apiKey: "oversized-response", fetchImplementation: fetchMock });

    await expect(client.getKeyInfo()).rejects.toMatchObject({ category: "UNEXPECTED_RESPONSE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses both cache layers on an explicit refresh and replaces the canonical cache entry", async () => {
    const chain = (current: number) => ({
      chain: {
        id: 12,
        current,
        max: 100,
        timeout: 210,
        modifier: 1,
        cooldown: 0,
        start: 1_700_000_000,
        end: 0,
      },
    });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(chain(41)))
      .mockResolvedValueOnce(Response.json(chain(42)));
    const client = new TornClient({
      apiKey: "fresh-cache-test",
      liveCacheSeconds: 60,
      fetchImplementation: fetchMock,
    });

    expect((await client.getCurrentChain()).chain.current).toBe(41);
    expect((await client.getCurrentChain(undefined, { forceRefresh: true, bypassUpstreamCache: true })).chain.current).toBe(42);
    expect((await client.getCurrentChain()).chain.current).toBe(42);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const refreshUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(refreshUrl.searchParams.get("timestamp")).toMatch(/^\d+$/);
  });

  it("translates permission failures without returning raw JSON", () => {
    const error = new TornApiError(16, "raw upstream detail");
    expect(userFacingTornError(error)).toContain("required Torn API selections");
    expect(userFacingTornError(error)).not.toContain("raw upstream detail");
  });
});

describe("chain response freshness", () => {
  it("caches the ongoing chain for less time than other live values", async () => {
    const chain = { chain: { id: 9, current: 21, max: 25, timeout: 300, modifier: 1, cooldown: 0, start: 1, end: 0 } };
    const fetchImplementation = vi.fn().mockImplementation(() => Promise.resolve(Response.json(chain)));
    const client = new TornClient({ apiKey: `chain-cache-${Math.random()}`, fetchImplementation, chainCacheSeconds: 0, liveCacheSeconds: 600 });

    await client.getCurrentChain();
    await client.getCurrentChain();

    // A zero-second chain window must not be served from the long live cache.
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("reports when Torn actually answered so a countdown can anchor to it", async () => {
    const chain = { chain: { id: 9, current: 21, max: 25, timeout: 300, modifier: 1, cooldown: 0, start: 1, end: 0 } };
    const fetchImplementation = vi.fn().mockImplementation(() => Promise.resolve(Response.json(chain)));
    const client = new TornClient({ apiKey: `chain-anchor-${Math.random()}`, fetchImplementation, chainCacheSeconds: 600 });

    const before = Date.now();
    await client.getCurrentChain();
    const first = client.getCurrentChainFetchedAt();
    expect(first).toBeGreaterThanOrEqual(before);

    // The cached read keeps the original fetch time rather than restamping it.
    await client.getCurrentChain();
    expect(client.getCurrentChainFetchedAt()).toBe(first);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
