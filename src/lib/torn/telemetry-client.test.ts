import { afterEach, describe, expect, it, vi } from "vitest";
import { isWorkspaceTelemetry, requestWorkspaceTelemetry } from "./telemetry-client";

describe("browser telemetry requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares an in-flight request between the scheduler and manual controls", async () => {
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { resolveResponse = resolve; });
    const fetchMock = vi.fn().mockReturnValue(response);
    vi.stubGlobal("fetch", fetchMock);

    const first = requestWorkspaceTelemetry("/api/telemetry/live-chain?fresh=1");
    const second = requestWorkspaceTelemetry("/api/telemetry/live-chain?fresh=1");
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveResponse(Response.json(telemetryFixture()));
    await expect(first).resolves.toMatchObject({ ok: true, payload: telemetryFixture() });
  });

  it("validates the complete client-safe telemetry envelope", () => {
    expect(isWorkspaceTelemetry(telemetryFixture())).toBe(true);
    expect(isWorkspaceTelemetry({ source: "live", checkedAt: "now" })).toBe(false);
  });
});

function telemetryFixture() {
  return {
    source: "live" as const,
    checkedAt: "2026-09-01T18:00:00.000Z",
    message: "Verified Torn API data.",
    faction: { id: 51_393, name: "Verified faction", tag: "VF", members: 47 },
    chain: null,
  };
}
