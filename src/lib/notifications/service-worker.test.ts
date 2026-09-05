import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync(new URL("../../../public/chainward-notifications.js", import.meta.url), "utf8");

interface WorkerEvent {
  data?: { json: () => unknown };
  waitUntil: (promise: Promise<unknown>) => void;
}

function createWorkerHarness() {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const claim = vi.fn().mockResolvedValue(undefined);
  const deleteCache = vi.fn().mockResolvedValue(true);
  const showNotification = vi.fn().mockResolvedValue(undefined);
  runInNewContext(workerSource, {
    URL,
    caches: { delete: deleteCache },
    self: {
      addEventListener: (type: string, handler: (event: WorkerEvent) => void) => handlers.set(type, handler),
      clients: { claim },
      location: { origin: "https://chainward.example" },
      registration: { showNotification },
      skipWaiting: vi.fn(),
    },
  });
  return {
    claim,
    deleteCache,
    handlers,
    showNotification,
    async dispatch(type: string, payload?: unknown) {
      const pending: Promise<unknown>[] = [];
      handlers.get(type)?.({
        data: payload === undefined ? undefined : { json: () => payload },
        waitUntil: (promise) => { pending.push(promise); },
      });
      await Promise.all(pending);
    },
  };
}

describe("notification service worker", () => {
  it("clears only the legacy avatar cache when the updated worker takes control", async () => {
    const worker = createWorkerHarness();

    await worker.dispatch("activate");

    expect(worker.claim).toHaveBeenCalledOnce();
    expect(worker.deleteCache.mock.calls).toEqual([["chainward-avatar-cache-v1"]]);
  });

  it("leaves profile image requests to the browser instead of caching opaque errors", () => {
    expect(createWorkerHarness().handlers.has("fetch")).toBe(false);
  });

  it("still activates when browser cache storage is unavailable", async () => {
    const worker = createWorkerHarness();
    worker.deleteCache.mockRejectedValue(new Error("Cache storage unavailable"));

    await expect(worker.dispatch("activate")).resolves.toBeUndefined();

    expect(worker.claim).toHaveBeenCalledOnce();
  });

  it("continues showing push notifications with a safe destination", async () => {
    const worker = createWorkerHarness();

    await worker.dispatch("push", {
      title: "Chain critical",
      body: "The chain has one minute remaining.",
      tag: "chain-123",
      url: "https://unrelated.example/",
    });

    expect(worker.showNotification).toHaveBeenCalledWith("Chain critical", expect.objectContaining({
      body: "The chain has one minute remaining.",
      tag: "chain-123",
      data: { url: "/dashboard" },
    }));
  });
});
