import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemberReportWorkspace } from "@/components/members/member-report-workspace";
import { hasPermission } from "@/lib/auth/authorization";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessAssignment } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { assessMemberActivity } from "@/lib/members/member-activity-intelligence";
import { getMemberActivityWorkspace } from "@/lib/members/member-activity-store";
import { getMemberProfileWorkspace } from "@/lib/members/member-profile-store";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Member report" };

export default async function MemberReportPage({ params }: { params: Promise<{ tornUserId: string }> }) {
  await requireLicensedPage();
  const { tornUserId: rawTornUserId } = await params;
  const tornUserId = Number(rawTornUserId);
  if (!Number.isInteger(tornUserId) || tornUserId <= 0) notFound();

  const [roster, telemetry, actor] = await Promise.all([getFactionRoster(), getWorkspaceTelemetry(), getCurrentActor()]);
  const member = roster.available ? roster.data.find((item) => item.tornId === tornUserId) : null;
  const factionId = telemetry.faction?.id ?? null;
  if (!member || !factionId) notFound();

  const [activity, assignment] = await Promise.all([
    getMemberActivityWorkspace(factionId),
    getFactionAccessAssignment(factionId, actor.tornUserId),
  ]);
  const canManage = isPlatformOwner(actor) || Boolean(assignment && hasPermission(assignment.role, "members:manage"));
  const profile = await getMemberProfileWorkspace(factionId, tornUserId, canManage);
  const parsedCheckedAt = Date.parse(roster.checkedAt);
  const checkedAt = Math.floor((Number.isNaN(parsedCheckedAt) ? member.lastActionAt * 1_000 : parsedCheckedAt) / 1_000);
  const activityAssessment = assessMemberActivity(
    member,
    activity.records.find((record) => record.tornUserId === tornUserId),
    checkedAt,
    activity.policy.thresholdDays,
  );

  return <MemberReportWorkspace
    member={member}
    factionId={factionId}
    source={roster.available ? (telemetry.mode === "offline" ? "Offline fixture" : "Torn API v2") : "Unavailable"}
    checkedAt={roster.checkedAt}
    profile={profile}
    activity={activityAssessment}
    canManage={canManage}
  />;
}
