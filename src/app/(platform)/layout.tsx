import { AppShell } from "@/components/shell/app-shell";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { WorkspaceLoadingScreen } from "@/components/ui/workspace-loading-screen";
import { hasPermission } from "@/lib/auth/authorization";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessAssignment } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { getDatabaseStatus } from "@/lib/data/database-status";
import { getFactionAccessSummary } from "@/lib/licensing/faction-access";
import { redactLockedTelemetry } from "@/lib/licensing/telemetry";
import { buildMemberActivityAlert } from "@/lib/members/member-activity-intelligence";
import { getMemberActivityWorkspace } from "@/lib/members/member-activity-store";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<WorkspaceLoadingScreen />}>
      <AuthenticatedPlatformLayout>{children}</AuthenticatedPlatformLayout>
    </Suspense>
  );
}

async function AuthenticatedPlatformLayout({ children }: { children: React.ReactNode }) {
  const [actor, telemetry, connection] = await Promise.all([
    getCurrentActor(),
    getWorkspaceTelemetry(),
    getConfiguredTornConnection(),
  ]);
  if (!actor.tornUserId || telemetry.source !== "live" || !telemetry.faction || !connection) redirect("/connect");
  if (connection.tornUserId !== actor.tornUserId || connection.factionId !== telemetry.faction.id) redirect("/connect");
  const factionId = telemetry.faction?.id ?? null;
  // None of these three depend on each other, and the database probe is the
  // slowest, so awaiting it on its own added its full latency to every render.
  const owner = isPlatformOwner(actor);
  const [database, access, assignment] = await Promise.all([
    getDatabaseStatus(),
    getFactionAccessSummary(factionId),
    owner ? Promise.resolve(null) : getFactionAccessAssignment(factionId, actor.tornUserId),
  ]);
  const currentRoster = access.state === "active" && assignment ? await getFactionRoster() : null;
  const currentRosterMember = !currentRoster?.available || currentRoster.data.some((member) => member.tornId === actor.tornUserId);
  const workspaceAuthorized = access.state === "active" && (owner || Boolean(assignment && currentRosterMember));
  const shellTelemetry = redactLockedTelemetry(telemetry, access, workspaceAuthorized);
  const canManageMembers = workspaceAuthorized && (owner || Boolean(assignment && hasPermission(assignment.role, "members:manage")));
  const memberActivityAlert = access.state === "active" && canManageMembers && factionId
    ? await Promise.all([getFactionRoster(), getMemberActivityWorkspace(factionId)]).then(([roster, activity]) => roster.available ? {
      factionId,
      factionName: telemetry.faction!.name,
      ...buildMemberActivityAlert(roster.data, activity, roster.checkedAt),
    } : null)
    : null;
  return <AppShell currentUser={actor} telemetry={shellTelemetry} access={access} workspaceAuthorized={workspaceAuthorized} database={database} memberActivityAlert={memberActivityAlert}>{children}</AppShell>;
}
