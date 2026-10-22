import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), actor: vi.fn(), telemetry: vi.fn(), report: vi.fn(), history: vi.fn(), roster: vi.fn() }));
vi.mock("@/lib/licensing/guards", () => ({ requireLicensedPage: mocks.guard }));
vi.mock("@/lib/auth/current-actor", () => ({ getCurrentActor: mocks.actor }));
vi.mock("@/lib/torn/telemetry-service", () => ({ getWorkspaceTelemetry: mocks.telemetry }));
vi.mock("@/lib/torn/workspace-data-service", () => ({ getCurrentChainReportView: mocks.report, getCompletedChainHistory: mocks.history, getFactionRoster: mocks.roster }));

import DashboardPage from "./page";

describe("overview progressive rendering", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.guard.mockResolvedValue(undefined);
    mocks.actor.mockResolvedValue({ tornUserId: 42, name: "Test member" });
    mocks.telemetry.mockResolvedValue({ source: "live", checkedAt: "2026-10-22T20:00:00.000Z", faction: { name: "Test faction" }, chain: null });
    mocks.report.mockReturnValue(new Promise(() => {}));
    mocks.history.mockReturnValue(new Promise(() => {}));
    mocks.roster.mockReturnValue(new Promise(() => {}));
  });

  it("returns the overview while report and history requests are still pending", async () => {
    // This would time out if any secondary data request blocks the page.
    await expect(DashboardPage()).resolves.toBeDefined();
    expect(mocks.report).toHaveBeenCalledOnce();
    expect(mocks.history).toHaveBeenCalledOnce();
  });

  it("does not start secondary data requests when page authorization fails", async () => {
    mocks.guard.mockRejectedValue(new Error("redirect:/unlock"));
    await expect(DashboardPage()).rejects.toThrow("redirect:/unlock");
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.telemetry).not.toHaveBeenCalled();
  });
});
