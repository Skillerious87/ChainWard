import { AppShell } from "@/components/shell/app-shell";
import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/authorization";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessWorkspace } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { getDatabaseStatus } from "@/lib/data/database-status";
import { getFactionAccessSummary } from "@/lib/licensing/faction-access";
import { redactLockedTelemetry } from "@/lib/licensing/telemetry";
import { buildMemberActivityAlert } from "@/lib/members/member-activity-intelligence";
import { getMemberActivityWorkspace } from "@/lib/members/member-activity-store";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const [actor, telemetry] = await Promise.all([
    getCurrentActor(),
    getWorkspaceTelemetry(),
  ]);
  if (!actor.tornUserId || telemetry.source !== "live" || !telemetry.faction) redirect("/connect");
  const factionId = telemetry.faction?.id ?? null;
  // None of these three depend on each other, and the database probe is the
  // slowest, so awaiting it on its own added its full latency to every render.
  const [database, access, accessWorkspace] = await Promise.all([
    getDatabaseStatus(),
    getFactionAccessSummary(factionId),
    getFactionAccessWorkspace(factionId),
  ]);
  const shellTelemetry = redactLockedTelemetry(telemetry, access);
  const assignment = accessWorkspace.assignments.find((item) => item.tornUserId === actor.tornUserId && item.status === "ACTIVE");
  const canManageMembers = isPlatformOwner(actor) || Boolean(assignment && hasPermission(assignment.role, "members:manage"));
  const memberActivityAlert = access.state === "active" && canManageMembers && factionId
    ? await Promise.all([getFactionRoster(), getMemberActivityWorkspace(factionId)]).then(([roster, activity]) => roster.available ? buildMemberActivityAlert(roster.data, activity, roster.checkedAt) : null)
    : null;
  return <AppShell currentUser={actor} telemetry={shellTelemetry} access={access} database={database} memberActivityAlert={memberActivityAlert}>{children}</AppShell>;
}
