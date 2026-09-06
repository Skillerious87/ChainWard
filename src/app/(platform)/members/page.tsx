import type { Metadata } from "next";
import { MemberActivityWorkspace } from "@/components/members/member-activity-workspace";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessAssignment } from "@/lib/auth/faction-access-store";
import { hasPermission } from "@/lib/auth/authorization";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getMemberActivityWorkspace, synchronizeMemberInactivityPeriods } from "@/lib/members/member-activity-store";
import { AUTO_SHARE_STALE_MS } from "@/lib/members/member-battle-stats";
import { getMemberBattleStatsWorkspace, readBattleStatsSharePreference } from "@/lib/members/member-battle-stats-store";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Member Activity" };

export default async function MembersPage() {
  await requireLicensedPage();
  const [roster, telemetry, actor] = await Promise.all([getFactionRoster(), getWorkspaceTelemetry(), getCurrentActor()]);
  const factionId = telemetry.faction?.id ?? null;
  const [activity, assignment, battleStats, sharePref] = await Promise.all([
    getMemberActivityWorkspace(factionId),
    getFactionAccessAssignment(factionId, actor.tornUserId),
    getMemberBattleStatsWorkspace(factionId),
    factionId && actor.tornUserId ? readBattleStatsSharePreference(factionId, actor.tornUserId) : Promise.resolve({ autoShare: false, lastAutoShareAt: null }),
  ]);
  const inactivityPeriods = telemetry.faction && roster.available && activity.databaseAvailable
    ? await synchronizeMemberInactivityPeriods(telemetry.faction, roster.data, activity.records, roster.checkedAt).catch(() => activity.inactivityPeriods)
    : activity.inactivityPeriods;
  const canManage = isPlatformOwner(actor) || Boolean(assignment && hasPermission(assignment.role, "members:manage"));

  // One server timestamp drives every "now"-relative label so the client's first
  // render matches this HTML exactly (no hydration text mismatch).
  const nowMs = new Date().getTime();
  const ownBattleStats = battleStats.records.find((record) => record.tornUserId === actor.tornUserId) ?? null;
  const autoShareReference = sharePref.lastAutoShareAt ?? ownBattleStats?.statsAt ?? null;
  const autoShareDue = sharePref.autoShare
    && (!autoShareReference || nowMs - Date.parse(autoShareReference) > AUTO_SHARE_STALE_MS);

  return <MemberActivityWorkspace
    rosterResult={roster}
    telemetry={telemetry}
    activity={{ ...activity, inactivityPeriods }}
    canManage={canManage}
    nowMs={nowMs}
    battleStats={{ records: battleStats.records, databaseAvailable: battleStats.databaseAvailable, message: battleStats.message }}
    currentUser={{ tornUserId: actor.tornUserId, name: actor.name }}
    autoShare={{ enabled: sharePref.autoShare, due: autoShareDue }}
  />;
}
