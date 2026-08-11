import type { Metadata } from "next";
import { MemberActivityWorkspace } from "@/components/members/member-activity-workspace";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessWorkspace } from "@/lib/auth/faction-access-store";
import { hasPermission } from "@/lib/auth/authorization";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getMemberActivityWorkspace } from "@/lib/members/member-activity-store";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Member Activity" };

export default async function MembersPage() {
  await requireLicensedPage();
  const [roster, telemetry, actor] = await Promise.all([getFactionRoster(), getWorkspaceTelemetry(), getCurrentActor()]);
  const factionId = telemetry.faction?.id ?? null;
  const [activity, access] = await Promise.all([getMemberActivityWorkspace(factionId), getFactionAccessWorkspace(factionId)]);
  const assignment = access.assignments.find((item) => item.tornUserId === actor.tornUserId && item.status === "ACTIVE");
  const canManage = isPlatformOwner(actor) || Boolean(assignment && hasPermission(assignment.role, "members:manage"));
  return <MemberActivityWorkspace rosterResult={roster} telemetry={telemetry} activity={activity} canManage={canManage} />;
}
