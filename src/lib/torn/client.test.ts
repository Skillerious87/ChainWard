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
