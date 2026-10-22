import { afterEach, describe, expect, it, vi } from "vitest";
import { isWorkspaceTelemetry, requestWorkspaceTelemetry } from "./telemetry-client";

describe("browser telemetry requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it.each([
    { chain: {} }, { chain: [] }, { faction: {} }, { faction: [] },
    { faction: { id: 1, name: "Faction", tag: "F", members: -1 } },
    { checkedAt: "invalid" }, { dataAgeMs: NaN }, { dataAgeMs: -1 }, { mode: "unknown" },
  ])("rejects malformed telemetry before it reaches countdown and navigation controls: %j", (invalid) => {
    expect(isWorkspaceTelemetry({ ...telemetryFixture(), ...invalid })).toBe(false);
  });

  it("bounds a stalled request and allows the next refresh to recover", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchMock = vi.fn().mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const request = requestWorkspaceTelemetry("/api/telemetry/live-chain");
    const failure = expect(request).rejects.toThrow("Timed out");
    expect(timeout).toHaveBeenCalledWith(15_000);
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    await failure;

    fetchMock.mockResolvedValueOnce(Response.json(telemetryFixture()));
    await expect(requestWorkspaceTelemetry("/api/telemetry/live-chain")).resolves.toMatchObject({ ok: true, payload: telemetryFixture() });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
