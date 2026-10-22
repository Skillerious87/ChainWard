import { AppShell } from "@/components/shell/app-shell";
import { ApiPoolPresence } from "@/components/settings/api-pool-presence";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import { PageSpinner } from "@/components/ui/page-spinner";
import { hasPermission } from "@/lib/auth/authorization";
import { getCurrentActor, getCurrentActorWithProfileImage } from "@/lib/auth/current-actor";
import { getFactionAccessAssignment, getFactionAccessWorkspace } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { getDatabaseStatus } from "@/lib/data/database-status";
import { getFactionAccessSummary } from "@/lib/licensing/faction-access";
import { getLicenceReviewCount, type PendingReviewSummary } from "@/lib/licensing/request-store";
import { redactLockedTelemetry } from "@/lib/licensing/telemetry";
import { buildMemberActivityAlert } from "@/lib/members/member-activity-intelligence";
import { getMemberActivityMonitorWorkspace, synchronizeMemberInactivityPeriods } from "@/lib/members/member-activity-store";
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
    <Suspense fallback={<PageSpinner label="Loading workspace" fullPage />}>
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
  // Stream the display-only avatar into its own boundary. It must never hold
  // the workspace behind a loading fallback while Torn's profile endpoint waits.
  const profileImagePromise = getCurrentActorWithProfileImage()
    .then((displayActor) => displayActor.profileImageUrl ?? null)
    .catch(() => actor.profileImageUrl ?? null);
  const owner = isPlatformOwner(actor);
  const assignmentPromise = owner
    ? Promise.resolve(null)
    : getFactionAccessAssignment(connection.factionId, actor.tornUserId);
  // Owner-only: what needs review right now, so the shell can badge/notify it
  // everywhere rather than only inside /admin itself.
  const pendingReviewPromise: Promise<PendingReviewSummary | null> = owner
    ? Promise.all([getLicenceReviewCount(), getFactionAccessWorkspace(connection.factionId)])
      .then(([licenceCount, factionAccess]) => ({ licenceCount, memberRequests: factionAccess.requests }))
    : Promise.resolve(null);
  const authorizationDataPromise = Promise.all([accessPromise, assignmentPromise]).then(async ([access, assignment]) => {
    const assigned = access.state === "active" && Boolean(assignment);
    const provisionallyCanManageMembers = access.state === "active"
      && (owner || Boolean(assignment && hasPermission(assignment.role, "members:manage")));
    const [currentRoster, memberActivity] = await Promise.all([
      assigned || provisionallyCanManageMembers ? getFactionRoster() : Promise.resolve(null),
      provisionallyCanManageMembers ? getMemberActivityMonitorWorkspace(connection.factionId) : Promise.resolve(null),
    ]);
    return { access, assignment, provisionallyCanManageMembers, currentRoster, memberActivity };
  });
  const [telemetry, database, authorizationData, pendingReview] = await Promise.all([
    telemetryPromise,
    databasePromise,
    authorizationDataPromise,
    pendingReviewPromise,
  ]);
  if (telemetry.faction && connection.factionId !== telemetry.faction.id) redirect("/connect");
  const factionId = connection.factionId;
  const { access, assignment, provisionallyCanManageMembers, currentRoster, memberActivity } = authorizationData;
  const currentRosterMember = !currentRoster?.available || currentRoster.data.some((member) => member.tornId === actor.tornUserId);
  const workspaceAuthorized = access.state === "active" && (owner || Boolean(assignment && currentRosterMember));
  const shellTelemetry = redactLockedTelemetry(telemetry, access, workspaceAuthorized);
  const canManageMembers = workspaceAuthorized && provisionallyCanManageMembers;
  if (canManageMembers && telemetry.faction && currentRoster?.available && memberActivity?.databaseAvailable) {
    const faction = telemetry.faction;
    // These durable history writes do not affect the rendered alert summary.
    // `after` keeps them alive on Vercel without holding the page response.
    after(() => synchronizeMemberInactivityPeriods(faction, currentRoster.data, memberActivity.records, currentRoster.checkedAt).then(() => undefined).catch(() => undefined));
  }
  const memberActivityAlert = canManageMembers && currentRoster?.available && memberActivity
    ? {
      factionId,
      factionName: telemetry.faction?.name ?? connection.factionName ?? "Connected faction",
      ...buildMemberActivityAlert(currentRoster.data, memberActivity, currentRoster.checkedAt),
    }
    : null;
  return <AppShell currentUser={actor} profileImage={profileImagePromise} telemetry={shellTelemetry} access={access} workspaceAuthorized={workspaceAuthorized} database={database} memberActivityAlert={memberActivityAlert} pendingReview={pendingReview}><ApiPoolPresence enabled={workspaceAuthorized && shellTelemetry.mode !== "offline"} />{children}</AppShell>;
}
