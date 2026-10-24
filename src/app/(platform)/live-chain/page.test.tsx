import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), report: vi.fn(), target: vi.fn() }));
vi.mock("@/lib/licensing/guards", () => ({ requireLicensedPage: mocks.authorize }));
vi.mock("@/lib/torn/workspace-data-service", () => ({ getCurrentChainReportView: mocks.report }));
vi.mock("@/lib/targets/best-target", () => ({ getBestChainTarget: mocks.target }));
vi.mock("@/components/chain/live-chain-workspace", () => ({ LiveChainWorkspace: () => null }));

import LiveChainPage from "./page";

beforeEach(() => vi.resetAllMocks());

describe("Live page navigation", () => {
  it("returns the live workspace while the contributor report is still pending, without a duplicate target check", async () => {
    const report = new Promise<never>(() => {});
    mocks.report.mockReturnValue(report);
    const page = await LiveChainPage();
    expect(page.props.report).toBe(report);
    expect(mocks.target).not.toHaveBeenCalled();
  });

  it("still authorizes access before starting or exposing report data", async () => {
    let authorize!: () => void;
    mocks.authorize.mockReturnValue(new Promise<void>((resolve) => { authorize = resolve; }));
    const page = LiveChainPage();
    await Promise.resolve();
    expect(mocks.report).not.toHaveBeenCalled();
    authorize();
    await page;
    expect(mocks.report).toHaveBeenCalledOnce();

    mocks.report.mockClear();
    mocks.authorize.mockRejectedValue(new Error("Access denied"));
    await expect(LiveChainPage()).rejects.toThrow("Access denied");
    expect(mocks.report).not.toHaveBeenCalled();
  });
});
