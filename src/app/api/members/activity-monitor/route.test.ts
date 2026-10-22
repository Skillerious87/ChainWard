import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ after: vi.fn(), permission: vi.fn(), roster: vi.fn(), workspace: vi.fn(), sync: vi.fn(), limit: vi.fn() }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/auth/faction-authorization", () => ({ requireFactionPermission: mocks.permission }));
vi.mock("@/lib/torn/workspace-data-service", () => ({ getFactionRoster: mocks.roster }));
vi.mock("@/lib/members/member-activity-store", () => ({ getMemberActivityMonitorWorkspace: mocks.workspace, synchronizeMemberInactivityPeriods: mocks.sync }));
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: mocks.limit, consumePartitionRateLimit: mocks.limit }));

import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockReturnValue({ allowed: true });
  mocks.permission.mockResolvedValue({ actor: { tornUserId: 42 }, faction: { id: 51393, name: "Test faction", tag: "T" } });
  mocks.roster.mockResolvedValue({ available: true, data: [], checkedAt: "2026-10-22T20:00:00Z" });
  mocks.workspace.mockResolvedValue({ databaseAvailable: true, policy: { thresholdDays: 3 }, records: [] });
  mocks.sync.mockResolvedValue([]);
});

describe("member monitor response latency", () => {
  it("returns the summary before history synchronization and schedules that work durably", async () => {
    const response = await GET(new Request("http://localhost/api/members/activity-monitor"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ factionId: 51393, attentionCount: 0 });
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledOnce();
    await mocks.after.mock.calls[0]![0]();
    expect(mocks.sync).toHaveBeenCalledOnce();
  });

  it("refuses to publish default-policy alerts during a storage outage", async () => {
    mocks.workspace.mockResolvedValue({ databaseAvailable: false, message: "Activity store unavailable" });
    const response = await GET(new Request("http://localhost/api/members/activity-monitor"));
    expect(response.status).toBe(503);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("does not read activity data or schedule writes when permission checks fail", async () => {
    mocks.permission.mockRejectedValue(new Error("Permission denied"));
    const response = await GET(new Request("http://localhost/api/members/activity-monitor"));
    expect(response.ok).toBe(false);
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
