// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChainHero } from "@/components/chain/chain-hero";
import { ChainPanicAlert } from "@/components/chain/chain-panic-alert";
import { ChainWatchWorkspace } from "@/components/chain/chain-watch-workspace";
import { readAppearancePreferences, saveAppearancePreferences } from "@/lib/appearance-preferences";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";
import { LiveWorkspaceTelemetryProvider, usePersistentChainCountdown } from "./live-workspace-telemetry";
import { AppShell } from "./app-shell";
import { publishNavigationState, RouteProgress } from "./route-progress";

const route = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/shell/profile-menu", () => ({ ProfileMenu: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("@/app/(platform)/chain-watch/actions", () => ({}));
vi.mock("@/app/(platform)/chain-watch/bulk-actions", () => ({}));
vi.mock("@/app/(platform)/chain-watch/rotation-actions", () => ({}));

const telemetry: WorkspaceTelemetry = {
  source: "live", checkedAt: "2026-10-22T00:30:00Z", faction: null, message: "Verified",
  chain: { id: 1, current: 1_200, maximum: 2_500, timeoutSeconds: 30, modifier: 1, cooldownSeconds: 0, startedAt: 0, endedAt: 0, state: "active" },
};
let root: Root | undefined;
let container: HTMLDivElement;

function workspace(children: ReactNode, seconds = 30, state = telemetry.chain!.state) {
  return <LiveWorkspaceTelemetryProvider value={{ telemetry: { ...telemetry, chain: { ...telemetry.chain!, state } }, seconds, deadlineAtSeconds: 1_792_628_000, nowSeconds: Date.parse(telemetry.checkedAt) / 1_000 }}>{children}</LiveWorkspaceTelemetryProvider>;
}

async function mount(node: ReactNode) {
  await act(async () => { root = createRoot(container); root.render(node); });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollTo = vi.fn();
  localStorage.clear();
  saveAppearancePreferences({ chainPanicMode: true });
  route.pathname = "/dashboard";
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("automatic panic mode", () => {
  it("defaults on for new and existing appearance records, preserving an explicit opt-out", () => {
    localStorage.clear();
    expect(readAppearancePreferences().chainPanicMode).toBe(true);
    localStorage.setItem("chainward:appearance:v1", JSON.stringify({ compact: true }));
    expect(readAppearancePreferences().chainPanicMode).toBe(true);
    saveAppearancePreferences({ chainPanicMode: false });
    expect(readAppearancePreferences().chainPanicMode).toBe(false);
  });

  it("activates without a chain console and lets the user turn it off while running", async () => {
    await mount(workspace(<ChainPanicAlert />));
    const off = document.querySelector<HTMLButtonElement>(".chain-panic-alert button");
    expect(off?.textContent).toBe("Turn off panic mode");
    await act(async () => off!.click());
    expect(document.querySelector(".chain-panic-alert")).toBeNull();
    expect(readAppearancePreferences().chainPanicMode).toBe(false);
    await act(async () => root!.render(workspace(<ChainPanicAlert />, 20)));
    expect(document.querySelector(".chain-panic-alert")).toBeNull();
  });

  it("clears on a hit and reactivates for the next final minute", async () => {
    await mount(workspace(<ChainPanicAlert />, 60));
    expect(document.querySelector(".chain-panic-alert")).not.toBeNull();
    for (const seconds of [300, 0]) {
      await act(async () => root!.render(workspace(<ChainPanicAlert />, seconds)));
      expect(document.querySelector(".chain-panic-alert")).toBeNull();
    }
    await act(async () => root!.render(workspace(<ChainPanicAlert />, 59)));
    expect(document.querySelector(".chain-panic-alert")).not.toBeNull();
    for (const state of ["idle", "cooldown"] as const) {
      await act(async () => root!.render(workspace(<ChainPanicAlert />, 30, state)));
      expect(document.querySelector(".chain-panic-alert")).toBeNull();
    }
  });
});

describe("server hydration", () => {
  it("hydrates the persistent shell with a different browser locale, time zone, and wall clock", async () => {
    const DateTimeFormat = Intl.DateTimeFormat;
    let defaultZone = "UTC";
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
      return new DateTimeFormat(locales, { timeZone: defaultZone, ...options });
    } as typeof Intl.DateTimeFormat);
    const originalDateString = Date.prototype.toLocaleString;
    vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (this: Date, locales, options) {
      return originalDateString.call(this, locales, { timeZone: defaultZone, ...options });
    });
    const node = <AppShell currentUser={{ name: "Tester", tornUserId: 123, isPlatformAdmin: false }} telemetry={telemetry} access={{ state: "active", label: "Monthly", expiresAt: "2026-10-29T00:30:00Z", reference: "test", startedAt: telemetry.checkedAt, plan: "Monthly", payment: null, message: null }} workspaceAuthorized database={{ configured: true, available: true, label: "Database", message: "Ready", provider: "postgresql", filename: null }} memberActivityAlert={null} pendingReview={null}><p>Workspace ready</p></AppShell>;
    container.innerHTML = renderToString(node);
    defaultZone = "America/Los_Angeles";
    const originalNumberString = Number.prototype.toLocaleString;
    vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(function (this: number, locales, options) {
      return originalNumberString.call(this, locales ?? "de-DE", options);
    });
    // The saved browser clock may be days ahead; the server snapshot still
    // determines renewal and countdown markup for the first client render.
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-01T12:00:00Z"));
    const recoverable = vi.fn();
    await act(async () => { root = hydrateRoot(container, node, { onRecoverableError: recoverable }); });
    expect(recoverable).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Workspace ready");
  });

  it("hydrates an active final-minute chain before mounting the browser-only portal", async () => {
    const node = workspace(<><ChainPanicAlert /><ChainHero /></>);
    container.innerHTML = renderToString(node);
    expect(container.innerHTML).not.toContain("chain-panic-alert");
    const recoverable = vi.fn();
    // Simulate a browser whose default numeric locale differs from the server.
    const original = Number.prototype.toLocaleString;
    vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(function (this: number, locales, options) {
      return original.call(this, locales ?? "de-DE", options);
    });
    await act(async () => { root = hydrateRoot(container, node, { onRecoverableError: recoverable }); });
    expect(recoverable).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1,200");
    expect(document.querySelector(".chain-panic-alert")).not.toBeNull();
  });

  it("renders idle timestamps consistently across server and browser time zones", () => {
    const DateTimeFormat = Intl.DateTimeFormat;
    let defaultZone = "UTC";
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
      return new DateTimeFormat(locales, { timeZone: defaultZone, ...options });
    } as typeof Intl.DateTimeFormat);
    const node = workspace(<ChainHero />, 0, "idle");
    const server = renderToString(node);
    defaultZone = "America/Los_Angeles";
    expect(renderToString(node)).toBe(server);
  });

  it("restores a saved watch timeline after hydration without changing the server snapshot", async () => {
    localStorage.setItem("chainward:chain-watch-view:v1", "timeline");
    const node = workspace(<ChainWatchWorkspace workspace={{ databaseConfigured: true, databaseAvailable: true, roleName: "Chain Watcher", bufferSeconds: 120, slots: [], message: "Ready" }} rosterResult={{ available: true, data: [], checkedAt: telemetry.checkedAt, message: "Verified" }} rotations={[]} canManage={false} />);
    container.innerHTML = renderToString(node);
    expect(container.querySelector(".chain-watch-view-toggle .active")?.textContent).toBe("List");
    const recoverable = vi.fn();
    await act(async () => { root = hydrateRoot(container, node, { onRecoverableError: recoverable }); });
    expect(recoverable).not.toHaveBeenCalled();
    expect(container.querySelector(".chain-watch-view-toggle .active")?.textContent).toBe("Timeline");
  });
});

describe("navigation feedback", () => {
  it("shows the spinner immediately and removes it as soon as navigation finishes", async () => {
    await mount(<RouteProgress />);
    expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => { publishNavigationState("page", true); });
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading page");
    await act(async () => { publishNavigationState("page", false); });
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector(".route-loading-core")).toBeNull();
    expect(document.documentElement.dataset.navigating).toBeUndefined();
  });

  it("waits for all actual pending operations without adding timers", async () => {
    await mount(<RouteProgress />);
    const timer = vi.spyOn(window, "setTimeout");
    await act(async () => { publishNavigationState("first", true); publishNavigationState("second", true); });
    await act(async () => { publishNavigationState("first", false); });
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => { publishNavigationState("second", false); });
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(timer).not.toHaveBeenCalled();
  });
});

describe("countdown render efficiency", () => {
  it("keeps checking the precise clock without rendering unchanged displayed values", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let renders = 0;
    function Clock() {
      const countdown = usePersistentChainCountdown(telemetry);
      renders += 1;
      return <span>{countdown.seconds}</span>;
    }
    await mount(<Clock />);
    const initialRenders = renders;
    for (const at of [250, 500, 750]) {
      now = at;
      await act(async () => { vi.advanceTimersByTime(250); });
    }
    expect(renders).toBe(initialRenders);
    expect(container.textContent).toBe("30");
    now = 1000;
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(container.textContent).toBe("29");
    expect(renders).toBe(initialRenders + 1);
  });
});
