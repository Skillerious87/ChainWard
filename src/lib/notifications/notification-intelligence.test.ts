import { describe, expect, it } from "vitest";
import { buildOperationalNotifications, chainRemainingSeconds } from "./notification-intelligence";
import type { MemberActivityMonitorSnapshot } from "@/lib/members/member-activity-intelligence";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";

const telemetry = (remaining: number): WorkspaceTelemetry => ({
  source: "live",
  mode: "torn",
  checkedAt: "2026-08-15T12:00:00.000Z",
  dataAgeMs: 2_100,
  faction: { id: 1, name: "Faction", tag: "FAC", members: 10 },
  chain: { id: 42, current: 25, maximum: 50, timeoutSeconds: remaining, modifier: 1, cooldownSeconds: 0, startedAt: 1, endedAt: 0, state: "active" },
  message: "Verified",
});

const memberActivity: MemberActivityMonitorSnapshot = {
  factionId: 1,
  factionName: "Faction",
  thresholdDays: 5,
  criticalAfterDays: 10,
  attentionCount: 2,
  criticalCount: 1,
  dueSoonCount: 0,
  expiredHolidayCount: 0,
  holidayCount: 0,
  watchedCount: 0,
  memberNames: ["Alpha", "Bravo"],
  alerts: [],
  fingerprint: "1:critical:inactivity",
  checkedAt: "2026-08-15T12:01:00.000Z",
};

describe("operational notification intelligence", () => {
  it("ages Torn's chain reading before deciding whether to alert", () => {
    expect(chainRemainingSeconds(telemetry(63))).toBe(60);
  });

  it("escalates the chain at one minute with a new acknowledgement identity", () => {
    const [notification] = buildOperationalNotifications({ telemetry: telemetry(63), chainWarningSeconds: 120, memberActivity: null });
    expect(notification).toMatchObject({ id: "chain:42:critical", tone: "danger", title: "Chain critical: 1:00 remaining" });
  });

  it("sorts urgent chain risk ahead of member review", () => {
    const notifications = buildOperationalNotifications({ telemetry: telemetry(45), chainWarningSeconds: 120, memberActivity });
    expect(notifications.map((item) => item.category)).toEqual(["chain", "members"]);
  });

  it("does not create a chain alert outside the configured warning window", () => {
    expect(buildOperationalNotifications({ telemetry: telemetry(240), chainWarningSeconds: 120, memberActivity: null })).toEqual([]);
  });
});
