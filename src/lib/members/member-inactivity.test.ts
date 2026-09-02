import { describe, expect, it } from "vitest";
import {
  buildMemberInactivityInsights,
  reconcileMemberInactivityPeriod,
  type MemberInactivityPeriod,
} from "./member-inactivity";

const day = 86_400;
const checkedAtSeconds = Date.parse("2026-09-02T12:00:00.000Z") / 1_000;
const checkedAt = new Date(checkedAtSeconds * 1_000).toISOString();

describe("member inactivity period reconciliation", () => {
  it("opens a period after 24 hours and preserves holiday context", () => {
    const result = reconcileMemberInactivityPeriod(
      undefined,
      { tornId: 42, name: "Robin", lastActionAt: checkedAtSeconds - 2 * day },
      { state: "HOLIDAY", holidayUntil: "2026-09-03T23:59:59.999Z" },
      checkedAt,
      () => "period-1",
    );

    expect(result.completed).toBeNull();
    expect(result.current).toMatchObject({
      id: "period-1",
      tornUserId: 42,
      startedAt: "2026-08-31T12:00:00.000Z",
      qualifyingAt: "2026-09-01T12:00:00.000Z",
      peakDurationSeconds: 2 * day,
      holidayProtected: true,
      watchListed: false,
    });
  });

  it("closes the prior gap at a newer last_action and opens a recurring gap when needed", () => {
    const existing = openPeriod({ sourceLastActionAt: checkedAtSeconds - 10 * day, startedAt: "2026-08-23T12:00:00.000Z" });
    const result = reconcileMemberInactivityPeriod(
      existing,
      { tornId: 42, name: "Robin", lastActionAt: checkedAtSeconds - 3 * day },
      { state: "WATCH" },
      checkedAt,
      () => "period-2",
    );

    expect(result.completed).toMatchObject({ id: "period-1", endedAt: "2026-08-30T12:00:00.000Z", peakDurationSeconds: 7 * day });
    expect(result.current).toMatchObject({ id: "period-2", startedAt: "2026-08-30T12:00:00.000Z", watchListed: true });
  });

  it("ignores an older cached roster snapshot", () => {
    const existing = openPeriod({ sourceLastActionAt: checkedAtSeconds - 2 * day, startedAt: "2026-08-31T12:00:00.000Z" });
    const result = reconcileMemberInactivityPeriod(
      existing,
      { tornId: 42, name: "Robin", lastActionAt: checkedAtSeconds - 3 * day },
      undefined,
      checkedAt,
      () => "unused",
    );
    expect(result).toEqual({ current: existing, completed: null, changed: false });
  });

  it("summarises repeat-member duration and weekday patterns", () => {
    const completed = { ...openPeriod(), endedAt: "2026-09-01T12:00:00.000Z", peakDurationSeconds: 2 * day };
    const current = { ...openPeriod({ id: "period-2", startedAt: "2026-08-31T12:00:00.000Z", sourceLastActionAt: checkedAtSeconds - 2 * day }), peakDurationSeconds: 2 * day };
    const insights = buildMemberInactivityInsights([completed, current], checkedAt);

    expect(insights).toMatchObject({ recordedPeriods: 2, completedPeriods: 1, openPeriods: 1, repeatMembers: 1, averageCompletedSeconds: 2 * day });
    expect(insights.patterns[0]).toMatchObject({ tornUserId: 42, periodCount: 2, completedCount: 1, typicalStartDay: "Sunday" });
  });
});

function openPeriod(overrides: Partial<MemberInactivityPeriod> = {}): MemberInactivityPeriod {
  return {
    id: "period-1",
    tornUserId: 42,
    memberName: "Robin",
    startedAt: "2026-08-30T12:00:00.000Z",
    qualifyingAt: "2026-08-31T12:00:00.000Z",
    firstObservedAt: "2026-09-01T12:00:00.000Z",
    lastObservedAt: "2026-09-02T11:00:00.000Z",
    endedAt: null,
    sourceLastActionAt: checkedAtSeconds - 3 * day,
    peakDurationSeconds: 3 * day,
    holidayProtected: false,
    watchListed: false,
    ...overrides,
  };
}
