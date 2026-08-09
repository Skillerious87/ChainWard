import { AppShell } from "@/components/shell/app-shell";
import { hasPermission } from "@/lib/auth/authorization";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessWorkspace } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { getDatabaseStatus } from "@/lib/data/database-status";
import { getFactionAccessSummary } from "@/lib/licensing/faction-access";
import { buildMemberActivityAlert } from "@/lib/members/member-activity-intelligence";
import { getMemberActivityWorkspace } from "@/lib/members/member-activity-store";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const [actor, telemetry, database] = await Promise.all([
    getCurrentActor(),
    getWorkspaceTelemetry(),
    getDatabaseStatus(),
  ]);
  const factionId = telemetry.faction?.id ?? null;
  const [access, accessWorkspace] = await Promise.all([getFactionAccessSummary(factionId), getFactionAccessWorkspace(factionId)]);
  const assignment = accessWorkspace.assignments.find((item) => item.tornUserId === actor.tornUserId && item.status === "ACTIVE");
  const canManageMembers = isPlatformOwner(actor) || Boolean(assignment && hasPermission(assignment.role, "members:manage"));
  const memberActivityAlert = canManageMembers && factionId
    ? await Promise.all([getFactionRoster(), getMemberActivityWorkspace(factionId)]).then(([roster, activity]) => roster.available ? buildMemberActivityAlert(roster.data, activity, roster.checkedAt) : null)
    : null;
  return <AppShell currentUser={actor} telemetry={telemetry} access={access} database={database} memberActivityAlert={memberActivityAlert}>{children}</AppShell>;
}
