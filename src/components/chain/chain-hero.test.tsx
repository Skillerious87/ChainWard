import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";

const mocks = vi.hoisted(() => ({ telemetry: vi.fn(), preferences: vi.fn() }));
vi.mock("@/components/shell/live-workspace-telemetry", () => ({ useLiveWorkspaceTelemetry: mocks.telemetry }));
vi.mock("@/lib/appearance-preferences", () => ({ useAppearancePreferences: mocks.preferences, saveAppearancePreferences: vi.fn() }));
vi.mock("./use-next-chain-target", () => ({ useNextChainTarget: (result: unknown) => result }));
vi.mock("react-dom", async (original) => ({ ...await original<typeof import("react-dom")>(), createPortal: (children: ReactNode) => children }));

import { ChainHero } from "./chain-hero";

function view(seconds: number, state: "active" | "idle" | "cooldown" = "active") {
  const telemetry: WorkspaceTelemetry = {
    source: "live", checkedAt: "2026-10-16T18:00:00Z", faction: null, message: "Verified",
    chain: { id: 1, current: 10, maximum: 25, timeoutSeconds: seconds, modifier: 1, cooldownSeconds: 0, startedAt: 0, endedAt: 0, state },
  };
  mocks.telemetry.mockReturnValue({ telemetry, seconds, deadlineAtSeconds: 100, nowSeconds: 0 });
  return renderToStaticMarkup(<ChainHero detailed bestTarget={{ target: null, targetCount: 2 }} />);
}

beforeEach(() => {
  mocks.preferences.mockReturnValue({ chainPanicMode: true });
  vi.stubGlobal("document", { body: {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("chain panic alert", () => {
  it.each([60, 59, 1])("shows the screen-edge alert at %i seconds", (seconds) => {
    const html = view(seconds);
    expect(html).toContain('class="chain-panic-alert" role="status"');
    expect(html).toContain("Panic mode on");
    expect(html).toContain("timeout-ring--critical");
  });

  it.each([61, 300, 0])("clears the alert outside the final minute, including a timer reset (%i)", (seconds) => {
    expect(view(seconds)).not.toContain('class="chain-panic-alert"');
  });

  it.each(["idle", "cooldown"] as const)("does not alarm during %s", (state) => {
    expect(view(30, state)).not.toContain('class="chain-panic-alert"');
  });

  it("lets an operator leave panic mode disabled", () => {
    mocks.preferences.mockReturnValue({ chainPanicMode: false });
    const html = view(30);
    expect(html).not.toContain('class="chain-panic-alert"');
    expect(html).toContain("Enable panic mode");
    expect(html).toContain('aria-pressed="false"');
  });
});
