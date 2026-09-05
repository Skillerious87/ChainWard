import type { Metadata } from "next";
import { OrganizedCrimesWorkspace } from "@/components/organized-crimes/organized-crimes-workspace";
import { hasPermission } from "@/lib/auth/authorization";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessAssignment } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getCrimeFeed } from "@/lib/organized-crimes/data-service";
import { reviewMembers } from "@/lib/organized-crimes/intelligence";
import { readMemberIntel, readOcReviewSettings, readOcSharePreference } from "@/lib/organized-crimes/store";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Organized Crimes" };

export default async function OrganizedCrimesPage() {
  await requireLicensedPage();

  const [roster, actor, connection, telemetry] = await Promise.all([
    getFactionRoster(),
    getCurrentActor(),
    getConfiguredTornConnection(),
    getWorkspaceTelemetry(),
  ]);
  const factionId = telemetry.faction?.id ?? connection?.factionId ?? null;

  const [assignment, allIntel, live, history, settings, sharePref] = await Promise.all([
    getFactionAccessAssignment(factionId, actor.tornUserId),
    factionId ? readMemberIntel(factionId) : Promise.resolve([]),
    getCrimeFeed("available"),
    getCrimeFeed("completed"),
    factionId ? readOcReviewSettings(factionId) : Promise.resolve({ minimumCpr: 70 }),
    factionId && actor.tornUserId ? readOcSharePreference(factionId, actor.tornUserId) : Promise.resolve({ autoShare: false, lastAutoShareAt: null }),
  ]);

  const canReview = isPlatformOwner(actor)
    || Boolean(assignment && assignment.status === "ACTIVE" && hasPermission(assignment.role, "oc:review"));

  // One server timestamp drives every "now"-relative label so the client's
  // first render matches this HTML exactly (no hydration text mismatch).
  const nowMs = new Date().getTime();
  const reviews = reviewMembers(
    roster.available ? roster.data : [],
    allIntel,
    live,
    history,
    nowMs,
    settings.minimumCpr,
  );
  const ownIntel = allIntel.find((record) => record.tornUserId === actor.tornUserId) ?? null;

  // The client fires an auto-refresh only when the member opted in and the last
  // push (auto or manual) is older than the window. Deciding it here keeps the
  // client effect a single guarded call.
  const AUTO_SHARE_STALE_MS = 12 * 60 * 60 * 1_000;
  const autoShareReference = sharePref.lastAutoShareAt ?? ownIntel?.statsAt ?? null;
  const autoShareDue = sharePref.autoShare
    && (!autoShareReference || nowMs - Date.parse(autoShareReference) > AUTO_SHARE_STALE_MS);

  return (
    <OrganizedCrimesWorkspace
      canReview={canReview}
      nowMs={nowMs}
      reviews={canReview ? reviews : null}
      ownIntel={ownIntel}
      currentUser={{ tornUserId: actor.tornUserId, name: actor.name }}
      autoShare={{ enabled: sharePref.autoShare, due: autoShareDue }}
      settings={settings}
      feeds={{
        live: { available: live.available, complete: live.complete, fetchedAt: live.fetchedAt, message: live.message, crimeCount: live.crimes.length },
        history: { available: history.available, complete: history.complete, fetchedAt: history.fetchedAt, message: history.message, crimeCount: history.crimes.length },
      }}
      roster={{ available: roster.available, message: roster.message, memberCount: roster.data.length }}
    />
  );
}
