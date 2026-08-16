import { describe, expect, it, vi } from "vitest";
import { loadWorkspaceTelemetry } from "./telemetry-service";

describe("workspace telemetry", () => {
  it("maps only verified Torn chain and faction fields", async () => {
    const client = {
      getFactionBasic: vi.fn().mockResolvedValue({ basic: { id: 51_393, name: "Verified faction", tag: "VF", members: 47 } }),
      getCurrentChain: vi.fn().mockResolvedValue({ chain: { id: 58_429_107, current: 742, max: 1_000, timeout: 161, modifier: 1, cooldown: 0, start: 1_786_196_400, end: 0 } }),
    };
    const result = await loadWorkspaceTelemetry(client, new Date("2026-08-08T17:00:00.000Z"));
    expect(result.source).toBe("live");
    expect(result.faction).toEqual({ id: 51_393, name: "Verified faction", tag: "VF", members: 47 });
    expect(result.chain).toMatchObject({ current: 742, maximum: 1_000, timeoutSeconds: 161, state: "active" });
    expect(result).not.toHaveProperty("apiKey");
  });

  it("fails closed when the API request cannot be validated", async () => {
    const client = {
      getFactionBasic: vi.fn().mockRejectedValue(new Error("network failure")),
      getCurrentChain: vi.fn().mockRejectedValue(new Error("network failure")),
    };
    const result = await loadWorkspaceTelemetry(client, new Date("2026-08-08T17:00:00.000Z"));
    expect(result.source).toBe("unavailable");
    expect(result.chain).toBeNull();
    expect(result.message).toContain("No operational values");
  });

  it("can apply separate freshness policies to the two operational endpoints", async () => {
    const client = {
      getFactionBasic: vi.fn().mockResolvedValue({ basic: { id: 51_393, name: "Verified faction", tag: "VF", members: 47 } }),
      getCurrentChain: vi.fn().mockResolvedValue({ chain: { id: 58_429_107, current: 742, max: 1_000, timeout: 161, modifier: 1, cooldown: 0, start: 1_786_196_400, end: 0 } }),
    };
    const chainOptions = { forceRefresh: true, bypassUpstreamCache: true };

    await loadWorkspaceTelemetry(client, new Date("2026-08-08T17:00:00.000Z"), { chain: chainOptions });

    expect(client.getFactionBasic).toHaveBeenCalledWith(undefined, undefined);
    expect(client.getCurrentChain).toHaveBeenCalledWith(undefined, chainOptions);
  });
});

describe("chain operational state", () => {
  const faction = { basic: { id: 51_393, name: "Verified faction", tag: "VF", members: 47 } };
  const checkedAt = new Date("2026-08-08T17:00:00.000Z");

  async function stateFor(chain: Record<string, number>) {
    const client = {
      getFactionBasic: vi.fn().mockResolvedValue(faction),
      getCurrentChain: vi.fn().mockResolvedValue({ chain: { id: 1, current: 0, max: 0, timeout: 0, modifier: 1, cooldown: 0, start: 0, end: 0, ...chain } }),
    };
    const result = await loadWorkspaceTelemetry(client, checkedAt);
    return result.chain;
  }

  it("treats a counting-down chain with hits as active", async () => {
    expect(await stateFor({ current: 12, timeout: 240 })).toMatchObject({ state: "active" });
  });

  it("derives cooldown from Torn's absolute cooldown deadline", async () => {
    const cooldownAt = Math.floor(checkedAt.getTime() / 1_000) + 1_800;
    expect(await stateFor({ current: 250, timeout: 0, end: 1_786_196_400, cooldown: cooldownAt })).toMatchObject({ state: "cooldown", cooldownSeconds: 1_800 });
  });

  it("does not treat a finished chain as active even while hits remain reported", async () => {
    expect(await stateFor({ current: 250, timeout: 0, end: 1_786_196_400 })).toMatchObject({ state: "idle" });
  });

  it("does not keep cooldown active after its deadline", async () => {
    const expiredCooldown = Math.floor(checkedAt.getTime() / 1_000) - 1;
    expect(await stateFor({ current: 250, timeout: 0, cooldown: expiredCooldown })).toMatchObject({ state: "idle", cooldownSeconds: 0 });
  });

  it("stays active while the timeout is counting down, even if an end timestamp is present", async () => {
    // Treating a non-zero `end` as proof the chain had finished reported a live
    // chain as idle while its hit count was still climbing.
    expect(await stateFor({ current: 19, timeout: 213, end: 1_786_200_000 })).toMatchObject({ state: "active" });
  });

  it("treats a timed-out chain as finished before Torn writes the end timestamp", async () => {
    expect(await stateFor({ current: 250, timeout: 0, end: 0 })).toMatchObject({ state: "idle" });
  });

  it("treats an absent chain as idle", async () => {
    expect(await stateFor({ id: 0 })).toMatchObject({ state: "idle" });
  });

  it("prefers the active state over a stale cooldown value", async () => {
    const futureCooldown = Math.floor(checkedAt.getTime() / 1_000) + 60;
    expect(await stateFor({ current: 30, timeout: 300, cooldown: futureCooldown })).toMatchObject({ state: "active" });
  });
});

describe("chain countdown staleness", () => {
  const faction = { basic: { id: 51_393, name: "Verified faction", tag: "VF", members: 47 } };
  const chain = { chain: { id: 9, current: 21, max: 25, timeout: 300, modifier: 1, cooldown: 0, start: 1, end: 0 } };

  it("reports how stale Torn's reading already is", async () => {
    const fetchedAtMs = Date.parse("2026-08-08T17:00:00.000Z");
    const client = {
      getFactionBasic: vi.fn().mockResolvedValue(faction),
      getCurrentChain: vi.fn().mockResolvedValue(chain),
      getCurrentChainFetchedAt: () => fetchedAtMs,
    };

    // Rendered 4 seconds after Torn answered: the countdown must start 4s in.
    const result = await loadWorkspaceTelemetry(client, new Date(fetchedAtMs + 4_000));

    expect(result.dataAgeMs).toBe(4_000);
    expect(result.chain?.timeoutSeconds).toBe(300);
  });

  it("measures staleness entirely within one clock, so a cached response never restarts the timer", async () => {
    const fetchedAtMs = Date.parse("2026-08-08T17:00:00.000Z");
    const client = {
      getFactionBasic: vi.fn().mockResolvedValue(faction),
      getCurrentChain: vi.fn().mockResolvedValue(chain),
      getCurrentChainFetchedAt: () => fetchedAtMs,
    };

    const first = await loadWorkspaceTelemetry(client, new Date(fetchedAtMs + 1_000));
    const later = await loadWorkspaceTelemetry(client, new Date(fetchedAtMs + 9_000));

    // Same cached reading, eight seconds apart: the remaining figure is
    // unchanged and the age grows, so both resolve to the same instant.
    expect(first.chain?.timeoutSeconds).toBe(later.chain?.timeoutSeconds);
    expect(later.dataAgeMs! - first.dataAgeMs!).toBe(8_000);
  });

  it("treats an unknown fetch time as fresh rather than guessing", async () => {
    const client = {
      getFactionBasic: vi.fn().mockResolvedValue(faction),
      getCurrentChain: vi.fn().mockResolvedValue(chain),
    };
    const result = await loadWorkspaceTelemetry(client, new Date("2026-08-08T17:00:00.000Z"));
    expect(result.dataAgeMs).toBe(0);
  });
});
