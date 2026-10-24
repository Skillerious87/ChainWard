// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveWorkspaceTelemetryProvider } from "@/components/shell/live-workspace-telemetry";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";
import type { TornChainReportView, TornDataResult } from "@/lib/torn/workspace-types";
import { LiveChainWorkspace } from "./live-chain-workspace";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/appearance-preferences", () => ({ useAppearancePreferences: () => ({ autoRefresh: false, chainPanicMode: false }), saveAppearancePreferences: vi.fn() }));

const telemetry: WorkspaceTelemetry = {
  source: "live", mode: "offline", checkedAt: "2026-10-23T00:00:00Z", message: "Fixture",
  faction: { id: 1, name: "Test faction", tag: "TF", members: 10 },
  chain: { id: 42, current: 20, maximum: 25, timeoutSeconds: 180, modifier: 1, cooldownSeconds: 0, startedAt: 0, endedAt: 0, state: "active" },
};
const result: TornDataResult<TornChainReportView | null> = {
  available: true, checkedAt: telemetry.checkedAt, message: "Report retrieved",
  data: { id: 42, factionId: 1, startedAt: 0, endedAt: 0, hits: 20, respect: 10, contributorCount: 1, targetCount: 1,
    contributions: [{ tornId: 123, name: "Report contributor", rank: 1, hits: 20, contribution: 100, respect: 10, status: "Okay" }] },
};
let container: HTMLDivElement;
let root: Root;

function render(report: Promise<typeof result>, current = telemetry) {
  root.render(<LiveWorkspaceTelemetryProvider value={{ telemetry: current, seconds: 180, deadlineAtSeconds: 180, nowSeconds: 0 }}><LiveChainWorkspace report={report} /></LiveWorkspaceTelemetryProvider>);
}

beforeEach(() => {
  refresh.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("progressive Live workspace", () => {
  it("shows the live timer while both reports and target verification are pending, then reveals the report independently", async () => {
    let resolve!: (value: typeof result) => void;
    const report = new Promise<typeof result>((done) => { resolve = done; });
    await act(async () => render(report));
    expect(container.querySelector("h1")?.textContent).toBe("Active chain");
    expect(container.querySelector('[aria-label="Chain timeout"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Loading chain contributors"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Checking next target"]')).not.toBeNull();
    expect(container.textContent).not.toContain("No targets tracked yet");
    expect(container.textContent).not.toContain("No matching chain report");
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => resolve(result));
    expect(container.textContent).toContain("Report contributor");
    expect(container.querySelector('[aria-label="Loading chain contributors"]')).toBeNull();
    expect(container.querySelector('[aria-label="Checking next target"]')).not.toBeNull();
  });

  it("hides contributors from a previous chain as soon as telemetry changes", async () => {
    const report = Promise.resolve(result);
    await act(async () => render(report));
    expect(container.textContent).toContain("Report contributor");
    await act(async () => render(report, { ...telemetry, chain: { ...telemetry.chain!, id: 43 } }));
    expect(container.textContent).not.toContain("Report contributor");
    expect(container.textContent).toContain("Retrieving contributors for the current chain");
    expect(refresh).toHaveBeenCalled();
  });

  it("withdraws a verified attack link immediately after a hit while its next check is pending", async () => {
    const target = { tornUserId: 456, name: "Verified target", level: 10, score: 1, reasons: [], attackUrl: "https://www.torn.com/loader.php?sid=attack&user2ID=456" };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ target, targetCount: 1 }));
    const report = Promise.resolve(result);
    await act(async () => render(report));
    expect(container.querySelector(`a[href="${target.attackUrl}"]`)).not.toBeNull();
    await act(async () => render(report, { ...telemetry, chain: { ...telemetry.chain!, current: 21 } }));
    expect(container.querySelector(`a[href="${target.attackUrl}"]`)).toBeNull();
    expect(container.querySelector('[aria-label="Checking next target"]')).not.toBeNull();
  });
});
