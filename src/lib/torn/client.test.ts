import { describe, expect, it, vi } from "vitest";
import { TornClient } from "./client";
import { TornApiError, userFacingTornError } from "./errors";

describe("TornClient", () => {
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
