import { describe, expect, it } from "vitest";
import { assessMemberActivity, buildMemberActivityAlert, criticalThreshold } from "./member-activity-intelligence";
import { DEFAULT_MEMBER_ACTIVITY_POLICY, type MemberActivityWorkspace } from "./member-activity-store";
import type { TornRosterMember } from "@/lib/torn/workspace-types";

const now = 2_000_000_000;
const member: TornRosterMember = { tornId: 42, name: "Robin", position: "Leader", level: 50, daysInFaction: 500, lastAction: "8 days ago", lastActionAt: now - 8 * 86_400, status: "Okay", statusDescription: "", statusUntil: 0 };

describe("member activity intelligence", () => {
  it("escalates inactivity and suppresses active holiday alerts", () => {
    expect(assessMemberActivity(member, undefined, now, 3)).toMatchObject({ band: "Critical", needsAttention: true, critical: true });
    const holiday = { tornUserId: 42, memberName: "Robin", state: "HOLIDAY" as const, holidayUntil: new Date((now + 86_400) * 1_000).toISOString(), note: "Away", updatedByTornId: 1, updatedByName: "Owner", updatedAt: new Date().toISOString() };
    expect(assessMemberActivity(member, holiday, now, 3)).toMatchObject({ holidayActive: true, needsAttention: false, critical: false, riskScore: 0 });
  });

  it("creates an owner alert summary using the saved policy", () => {
    const workspace: MemberActivityWorkspace = { databaseConfigured: true, databaseAvailable: true, policy: { ...DEFAULT_MEMBER_ACTIVITY_POLICY, thresholdDays: 5 }, records: [], audit: [], message: "Ready" };
    const alert = buildMemberActivityAlert([member], workspace, new Date(now * 1_000).toISOString());
    expect(alert).toMatchObject({ thresholdDays: 5, criticalAfterDays: 10, attentionCount: 1, criticalCount: 0, dueSoonCount: 0, memberNames: ["Robin"] });
    expect(alert.alerts).toEqual([expect.objectContaining({ tornUserId: 42, severity: "attention", trigger: "inactivity" })]);
    expect(alert.fingerprint).toBe("42:attention:inactivity");
  });

  it("treats a critically inactive watched member as an inactivity escalation", () => {
    const watched = { tornUserId: 42, memberName: "Robin", state: "WATCH" as const, holidayUntil: null, note: "Leadership follow-up", updatedByTornId: 1, updatedByName: "Owner", updatedAt: new Date().toISOString() };
    const workspace: MemberActivityWorkspace = { databaseConfigured: true, databaseAvailable: true, policy: { ...DEFAULT_MEMBER_ACTIVITY_POLICY, thresholdDays: 3 }, records: [watched], audit: [], message: "Ready" };
    const alert = buildMemberActivityAlert([member], workspace, new Date(now * 1_000).toISOString());
    expect(alert.alerts[0]).toMatchObject({ severity: "critical", trigger: "inactivity" });
    expect(alert.alerts[0]?.reason).toContain("critical escalation reached");
  });

  it("keeps protected and watched policy states out of misleading activity bands", () => {
    const dueSoonMember = { ...member, lastAction: "2 days ago", lastActionAt: now - 2 * 86_400 };
    const holiday = { tornUserId: 42, memberName: "Robin", state: "HOLIDAY" as const, holidayUntil: new Date((now + 86_400) * 1_000).toISOString(), note: "Away", updatedByTornId: 1, updatedByName: "Owner", updatedAt: new Date().toISOString() };
    const watch = { ...holiday, state: "WATCH" as const, holidayUntil: null, note: "Check in" };

    expect(assessMemberActivity(dueSoonMember, holiday, now, 3)).toMatchObject({ band: "Protected", needsAttention: false, riskScore: 0 });
    expect(assessMemberActivity(dueSoonMember, watch, now, 3)).toMatchObject({ band: "Watch", needsAttention: true, reason: "Check in" });

    const workspace: MemberActivityWorkspace = { databaseConfigured: true, databaseAvailable: true, policy: { ...DEFAULT_MEMBER_ACTIVITY_POLICY, thresholdDays: 3 }, records: [holiday], audit: [], message: "Ready" };
    expect(buildMemberActivityAlert([dueSoonMember], workspace, new Date(now * 1_000).toISOString()).dueSoonCount).toBe(0);
  });

  it("prioritises critical inactivity after a holiday expires", () => {
    const expiredHoliday = { tornUserId: 42, memberName: "Robin", state: "HOLIDAY" as const, holidayUntil: new Date((now - 86_400) * 1_000).toISOString(), note: "Away", updatedByTornId: 1, updatedByName: "Owner", updatedAt: new Date().toISOString() };
    const workspace: MemberActivityWorkspace = { databaseConfigured: true, databaseAvailable: true, policy: { ...DEFAULT_MEMBER_ACTIVITY_POLICY, thresholdDays: 3 }, records: [expiredHoliday], audit: [], message: "Ready" };
    const alert = buildMemberActivityAlert([member], workspace, new Date(now * 1_000).toISOString());

    expect(alert.alerts[0]).toMatchObject({ severity: "critical", trigger: "inactivity" });
    expect(alert.alerts[0]?.reason).toContain("after holiday protection expired");
  });

  it("normalises malformed thresholds before calculating escalation", () => {
    expect(criticalThreshold(Number.NaN)).toBe(6);
    expect(criticalThreshold(100)).toBe(60);
    expect(criticalThreshold(-4)).toBe(3);
  });
});
