import type { Metadata } from "next";
import { MemberActivityWorkspace } from "@/components/members/member-activity-workspace";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessAssignment } from "@/lib/auth/faction-access-store";
import { hasPermission } from "@/lib/auth/authorization";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getMemberActivityWorkspace, synchronizeMemberInactivityPeriods } from "@/lib/members/member-activity-store";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Member Activity" };

export default async function MembersPage() {
  await requireLicensedPage();
  const [roster, telemetry, actor] = await Promise.all([getFactionRoster(), getWorkspaceTelemetry(), getCurrentActor()]);
  const factionId = telemetry.faction?.id ?? null;
  const [activity, assignment] = await Promise.all([getMemberActivityWorkspace(factionId), getFactionAccessAssignment(factionId, actor.tornUserId)]);
  const inactivityPeriods = telemetry.faction && roster.available && activity.databaseAvailable
    ? await synchronizeMemberInactivityPeriods(telemetry.faction, roster.data, activity.records, roster.checkedAt).catch(() => activity.inactivityPeriods)
    : activity.inactivityPeriods;
  const canManage = isPlatformOwner(actor) || Boolean(assignment && hasPermission(assignment.role, "members:manage"));
  return <MemberActivityWorkspace rosterResult={roster} telemetry={telemetry} activity={{ ...activity, inactivityPeriods }} canManage={canManage} />;
}
