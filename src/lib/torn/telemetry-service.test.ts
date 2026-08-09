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

  it("passes explicit freshness options to both operational endpoints", async () => {
    const client = {
      getFactionBasic: vi.fn().mockResolvedValue({ basic: { id: 51_393, name: "Verified faction", tag: "VF", members: 47 } }),
      getCurrentChain: vi.fn().mockResolvedValue({ chain: { id: 58_429_107, current: 742, max: 1_000, timeout: 161, modifier: 1, cooldown: 0, start: 1_786_196_400, end: 0 } }),
    };
    const options = { forceRefresh: true, bypassUpstreamCache: true };

    await loadWorkspaceTelemetry(client, new Date("2026-08-08T17:00:00.000Z"), options);

    expect(client.getFactionBasic).toHaveBeenCalledWith(undefined, options);
    expect(client.getCurrentChain).toHaveBeenCalledWith(undefined, options);
  });
});
