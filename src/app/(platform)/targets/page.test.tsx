import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), actor: vi.fn(), connection: vi.fn(), telemetry: vi.fn(), list: vi.fn(), configured: vi.fn(), enrich: vi.fn() }));
vi.mock("@/lib/licensing/guards", () => ({ requireLicensedPage: mocks.guard }));
vi.mock("@/lib/auth/current-actor", () => ({ getCurrentActor: mocks.actor }));
vi.mock("@/lib/torn/server-client", () => ({ getConfiguredTornConnection: mocks.connection }));
vi.mock("@/lib/torn/telemetry-service", () => ({ getWorkspaceTelemetry: mocks.telemetry }));
vi.mock("@/lib/targets/store", () => ({ readTargetList: mocks.list, targetsStorageAvailable: () => true }));
vi.mock("@/lib/targets/ffscouter-key-store", () => ({ hasFfscouterKey: mocks.configured }));
vi.mock("@/lib/targets/ffscouter", () => ({ enrichWithFairFight: mocks.enrich }));
vi.mock("@/components/targets/targets-workspace", () => ({ TargetsWorkspace: () => null }));

import TargetsPage from "./page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue({ tornUserId: 1 });
  mocks.connection.mockResolvedValue({ factionId: 10 });
  mocks.telemetry.mockResolvedValue({ chain: null, checkedAt: "2026-10-24T12:00:00Z" });
  mocks.list.mockResolvedValue({ entries: [{ tornUserId: 2 }], snapshots: {} });
  mocks.configured.mockResolvedValue(true);
  mocks.enrich.mockReturnValue(new Promise(() => {}));
});

describe("Targets navigation", () => {
  it("renders saved targets without waiting for optional upstream enrichment", async () => {
    const page = await TargetsPage();
    expect(page.props.entries).toEqual([{ tornUserId: 2 }]);
    expect(page.props.ffscouterConfigured).toBe(true);
    expect(page.props.fairFight).toEqual({});
    expect(mocks.enrich).not.toHaveBeenCalled();
  });

  it("authorizes before reading any target or configuration data", async () => {
    mocks.guard.mockRejectedValue(new Error("Access denied"));
    await expect(TargetsPage()).rejects.toThrow("Access denied");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.configured).not.toHaveBeenCalled();
  });
});
