import { AppShell } from "@/components/shell/app-shell";
import type { Metadata } from "next";
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
import { getMemberActivityWorkspace, synchronizeMemberInactivityPeriods } from "@/lib/members/member-activity-store";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<WorkspaceLoadingScreen />}>
      <AuthenticatedPlatformLayout>{children}</AuthenticatedPlatformLayout>
    </Suspense>
  );
}

async function AuthenticatedPlatformLayout({ children }: { children: React.ReactNode }) {
  const connection = await getConfiguredTornConnection();
  if (!connection) redirect("/connect");

  // The connection already supplies the trusted tenant ID, so database work
  // can begin while Torn prepares the display telemetry instead of waiting for
  // that network response first.
  const telemetryPromise = getWorkspaceTelemetry();
  const databasePromise = getDatabaseStatus();
  const accessPromise = getFactionAccessSummary(connection.factionId);
  const actor = await getCurrentActor();
  if (!actor.tornUserId || connection.tornUserId !== actor.tornUserId) redirect("/connect");
  const owner = isPlatformOwner(actor);
  const assignmentPromise = owner
    ? Promise.resolve(null)
    : getFactionAccessAssignment(connection.factionId, actor.tornUserId);
  const authorizationDataPromise = Promise.all([accessPromise, assignmentPromise]).then(async ([access, assignment]) => {
    const assigned = access.state === "active" && Boolean(assignment);
    const provisionallyCanManageMembers = access.state === "active"
      && (owner || Boolean(assignment && hasPermission(assignment.role, "members:manage")));
    const [currentRoster, memberActivity] = await Promise.all([
      assigned || provisionallyCanManageMembers ? getFactionRoster() : Promise.resolve(null),
      provisionallyCanManageMembers ? getMemberActivityWorkspace(connection.factionId) : Promise.resolve(null),
    ]);
    return { access, assignment, provisionallyCanManageMembers, currentRoster, memberActivity };
  });
  const [telemetry, database, authorizationData] = await Promise.all([
    telemetryPromise,
    databasePromise,
    authorizationDataPromise,
  ]);
  if (telemetry.source !== "live" || !telemetry.faction || connection.factionId !== telemetry.faction.id) redirect("/connect");
  const factionId = telemetry.faction.id;
  const { access, assignment, provisionallyCanManageMembers, currentRoster, memberActivity } = authorizationData;
  const currentRosterMember = !currentRoster?.available || currentRoster.data.some((member) => member.tornId === actor.tornUserId);
  const workspaceAuthorized = access.state === "active" && (owner || Boolean(assignment && currentRosterMember));
  const shellTelemetry = redactLockedTelemetry(telemetry, access, workspaceAuthorized);
  const canManageMembers = workspaceAuthorized && provisionallyCanManageMembers;
  if (canManageMembers && currentRoster?.available && memberActivity?.databaseAvailable) {
    await synchronizeMemberInactivityPeriods(telemetry.faction, currentRoster.data, memberActivity.records, currentRoster.checkedAt).catch(() => undefined);
  }
  const memberActivityAlert = canManageMembers && currentRoster?.available && memberActivity
    ? {
      factionId,
      factionName: telemetry.faction.name,
      ...buildMemberActivityAlert(currentRoster.data, memberActivity, currentRoster.checkedAt),
    }
    : null;
  return <AppShell currentUser={actor} telemetry={shellTelemetry} access={access} workspaceAuthorized={workspaceAuthorized} database={database} memberActivityAlert={memberActivityAlert}>{children}</AppShell>;
}
