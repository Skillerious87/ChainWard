// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiPoolPresence } from "./api-pool-presence";
import { useMemberActivityMonitor } from "@/components/members/use-member-activity-monitor";
import type { MemberActivityMonitorSnapshot } from "@/lib/members/member-activity-intelligence";

const preferences = vi.hoisted(() => ({ enabled: true, intervalMinutes: 1 }));
vi.mock("@/lib/member-notification-preferences", () => ({
  useMemberNotificationPreferences: () => preferences,
  ensureNotificationWorker: vi.fn(async () => undefined),
  getBrowserNotificationPermission: () => "default",
  isNotificationQuietTime: () => false,
  showWindowsNotification: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T20:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("background request recovery", () => {
  it("aborts a stalled presence heartbeat and sends a later heartbeat", async () => {
    await act(async () => root.render(<ApiPoolPresence enabled />));
    expect(fetchMock).toHaveBeenCalledOnce();
    const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(signal.aborted).toBe(true);
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const active = fetchMock.mock.calls[1]![1].signal as AbortSignal;
    await act(async () => root.render(<ApiPoolPresence enabled={false} />));
    expect(active.aborted).toBe(true);
  });

  it("bounds member monitoring and cancels the pending request on unmount", async () => {
    const snapshot = { checkedAt: new Date().toISOString(), factionId: 1, factionName: "Test faction", alerts: [] } as unknown as MemberActivityMonitorSnapshot;
    function Monitor() { useMemberActivityMonitor(snapshot); return null; }
    await act(async () => root.render(<Monitor />));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(fetchMock).toHaveBeenCalledOnce();
    const first = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(first.aborted).toBe(true);
    await act(async () => { vi.advanceTimersByTime(45_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const active = fetchMock.mock.calls[1]![1].signal as AbortSignal;
    await act(async () => root.render(null));
    expect(active.aborted).toBe(true);
  });
});
