// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/shell/workspace-section-navigation", () => ({ useWorkspaceSectionNavigation: () => ({ view: "list" }) }));
vi.mock("@/app/(platform)/targets/actions", () => ({}));
vi.mock("@/lib/member-notification-preferences", () => ({ getBrowserNotificationPermission: () => "default", showWindowsNotification: vi.fn() }));
import { TargetsWorkspace } from "./targets-workspace";

let root: Root;
let container: HTMLDivElement;
let unmounted: boolean;
const props = {
  entries: [{ tornUserId: 2, label: "Target", note: "", pinned: false, tags: [], addedAt: "2026-10-24T12:00:00Z" }],
  snapshots: {}, errors: {}, source: "Torn API v2", fetchedAt: null, nowMs: Date.now(), connected: true, storageAvailable: true,
  chain: null, chainDataAgeMs: 0, chainCheckedAt: "2026-10-24T12:00:00Z", fairFight: {}, ffscouterConfigured: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  unmounted = false;
});

afterEach(async () => {
  if (!unmounted) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function leave() {
  await act(async () => root.unmount());
  unmounted = true;
}

describe("Targets background refresh lifecycle", () => {
  it("cancels the outstanding catch-up request when navigating away", async () => {
    await act(async () => root.render(<TargetsWorkspace {...props} />));
    expect(fetch).toHaveBeenCalledOnce();
    const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
    expect(signal.aborted).toBe(false);
    await leave();
    expect(signal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("stops the scheduled backlog and final enrichment poll on navigation", async () => {
    vi.mocked(fetch).mockImplementation(async () => Response.json({ snapshots: [], errors: {}, fairFight: {}, dueTotal: 20 }));
    await act(async () => root.render(<TargetsWorkspace {...props} />));
    expect(fetch).toHaveBeenCalledOnce();
    await leave();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not overlap live polls and cancels them on navigation", async () => {
    await act(async () => root.render(<TargetsWorkspace {...props} entries={[]} />));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(fetch).toHaveBeenCalledOnce();
    const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
    await leave();
    expect(signal.aborted).toBe(true);
  });

  it("restarts the initial refresh after Strict Mode cleanup", async () => {
    await act(async () => root.render(<StrictMode><TargetsWorkspace {...props} /></StrictMode>));
    expect(fetch).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0]![1]!.signal!.aborted).toBe(true);
    expect(calls[1]![1]!.signal!.aborted).toBe(false);
  });
});
