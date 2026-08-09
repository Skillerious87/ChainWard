import type { MemberActivityRecord, MemberActivityWorkspace } from "./member-activity-store";
import type { TornRosterMember } from "@/lib/torn/workspace-types";

const DAY_SECONDS = 86_400;

export type MemberActivityBand = "Active" | "Recent" | "Due soon" | "Review" | "Critical";

export interface MemberActivityAssessment {
  member: TornRosterMember;
  record?: MemberActivityRecord;
  ageSeconds: number;
  daysInactive: number;
  band: MemberActivityBand;
  holidayActive: boolean;
  holidayExpired: boolean;
  needsAttention: boolean;
  critical: boolean;
  riskScore: number;
  reason: string;
}

export interface MemberActivityAlertSummary {
  thresholdDays: number;
  criticalAfterDays: number;
  attentionCount: number;
  criticalCount: number;
  holidayCount: number;
  watchedCount: number;
  memberNames: string[];
  checkedAt: string;
}

export function assessMemberActivity(member: TornRosterMember, record: MemberActivityRecord | undefined, checkedAtSeconds: number, thresholdDays: number): MemberActivityAssessment {
  const safeCheckedAt = Number.isFinite(checkedAtSeconds) ? checkedAtSeconds : Math.floor(Date.now() / 1_000);
  const ageSeconds = Math.max(0, safeCheckedAt - member.lastActionAt);
  const daysInactive = ageSeconds / DAY_SECONDS;
  const holidayEnd = record?.holidayUntil ? Date.parse(record.holidayUntil) / 1_000 : null;
  const holidayActive = record?.state === "HOLIDAY" && (holidayEnd === null || (!Number.isNaN(holidayEnd) && holidayEnd >= safeCheckedAt));
  const holidayExpired = record?.state === "HOLIDAY" && holidayEnd !== null && (Number.isNaN(holidayEnd) || holidayEnd < safeCheckedAt);
  const criticalAfterDays = criticalThreshold(thresholdDays);
  const critical = !holidayActive && daysInactive >= criticalAfterDays;
  const thresholdExceeded = daysInactive >= thresholdDays;
  const watched = record?.state === "WATCH";
  const needsAttention = !holidayActive && (watched || holidayExpired || thresholdExceeded);
  const band: MemberActivityBand = critical
    ? "Critical"
    : thresholdExceeded
      ? "Review"
      : daysInactive >= Math.max(1, thresholdDays - 1)
        ? "Due soon"
        : daysInactive > 1
          ? "Recent"
          : "Active";
  const reason = holidayActive
    ? record?.holidayUntil ? `Holiday protected until ${new Date(record.holidayUntil).toLocaleDateString("en-GB")}` : "Open-ended holiday protection"
    : watched
      ? record.note || "Manually added to the watch list"
      : holidayExpired
        ? "Holiday protection has expired"
        : critical
          ? `${Math.floor(daysInactive)} days inactive; critical escalation reached`
          : thresholdExceeded
            ? `${Math.floor(daysInactive)} days inactive; owner threshold exceeded`
            : band === "Due soon"
              ? "Approaching the owner alert threshold"
              : "Within the faction activity policy";
  const riskScore = holidayActive ? 0 : watched ? 100 : holidayExpired ? 95 : critical ? Math.min(99, 85 + Math.floor(daysInactive - criticalAfterDays)) : thresholdExceeded ? 70 + Math.min(14, Math.floor(daysInactive - thresholdDays)) : band === "Due soon" ? 45 : Math.min(30, Math.floor(daysInactive * 10));
  return { member, record, ageSeconds, daysInactive, band, holidayActive, holidayExpired, needsAttention, critical, riskScore, reason };
}

export function buildMemberActivityAlert(members: TornRosterMember[], workspace: MemberActivityWorkspace, checkedAt: string): MemberActivityAlertSummary {
  const parsedCheckedAt = Date.parse(checkedAt);
  const checkedAtSeconds = Math.floor((Number.isNaN(parsedCheckedAt) ? Date.now() : parsedCheckedAt) / 1_000);
  const recordById = new Map(workspace.records.map((record) => [record.tornUserId, record]));
  const assessments = members.map((member) => assessMemberActivity(member, recordById.get(member.tornId), checkedAtSeconds, workspace.policy.thresholdDays));
  const attention = assessments.filter((item) => item.needsAttention).toSorted((left, right) => right.riskScore - left.riskScore || right.daysInactive - left.daysInactive);
  return {
    thresholdDays: workspace.policy.thresholdDays,
    criticalAfterDays: criticalThreshold(workspace.policy.thresholdDays),
    attentionCount: attention.length,
    criticalCount: attention.filter((item) => item.critical).length,
    holidayCount: assessments.filter((item) => item.holidayActive).length,
    watchedCount: assessments.filter((item) => item.record?.state === "WATCH").length,
    memberNames: attention.slice(0, 3).map((item) => item.member.name),
    checkedAt: Number.isNaN(parsedCheckedAt) ? new Date().toISOString() : checkedAt,
  };
}

export function criticalThreshold(thresholdDays: number): number {
  return Math.max(thresholdDays + 2, thresholdDays * 2);
}
