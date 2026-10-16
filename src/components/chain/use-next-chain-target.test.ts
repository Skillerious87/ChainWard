import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchNextChainTarget } from "./use-next-chain-target";

const result = { target: null, targetCount: 2 };
let browserWindow: EventTarget;
let browserDocument: EventTarget & { visibilityState: string };
let network: { onLine: boolean };
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
  browserWindow = new EventTarget();
  browserDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
  network = { onLine: true };
  vi.stubGlobal("window", browserWindow);
  vi.stubGlobal("document", browserDocument);
  vi.stubGlobal("navigator", network);
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(result));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function watch(autoRefresh = true) {
  const onResult = vi.fn();
  const onUnavailable = vi.fn();
  stop = watchNextChainTarget({ autoRefresh, onResult, onUnavailable });
  return { onResult, onUnavailable };
}

describe("live next-target checks", () => {
  it("checks on mount and every 15 seconds while the page is visible", async () => {
    const { onResult } = watch();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(result);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/targets/next", expect.objectContaining({ cache: "no-store" }));
  });

  it("checks on return from Torn without waiting for the next poll and coalesces focus with visibility", async () => {
    watch();
    await vi.advanceTimersByTimeAsync(6_000);
    browserWindow.dispatchEvent(new Event("focus"));
    browserDocument.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("checks again if the player returns while an earlier request is still in flight", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    watch();
    await vi.advanceTimersByTimeAsync(6_000);
    browserWindow.dispatchEvent(new Event("focus"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(Response.json(result));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("defers a quick return instead of dropping it", async () => {
    watch();
    await vi.advanceTimersByTimeAsync(1_000);
    browserWindow.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(3_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips hidden/offline polling and checks when connectivity returns", async () => {
    watch();
    await vi.advanceTimersByTimeAsync(0);
    browserDocument.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(15_000);
    browserDocument.visibilityState = "visible";
    network.onLine = false;
    browserWindow.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    network.onLine = true;
    browserWindow.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops interval polling when automatic refresh is disabled, while return checks still work", async () => {
    watch(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    browserWindow.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not let an old response overwrite the target after a chain or hit change", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const old = watch();
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    stop?.();
    const current = watch();
    resolve(Response.json({ target: null, targetCount: 99 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(true);
    expect(old.onResult).not.toHaveBeenCalled();
    expect(old.onUnavailable).not.toHaveBeenCalled();
    expect(current.onResult).toHaveBeenCalledWith(result);
  });

  it("surfaces failed checks instead of retaining an unverified attack link", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "limited" }, { status: 429 }));
    const { onResult, onUnavailable } = watch();
    await vi.advanceTimersByTimeAsync(0);
    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(onResult).not.toHaveBeenCalled();
  });
});
