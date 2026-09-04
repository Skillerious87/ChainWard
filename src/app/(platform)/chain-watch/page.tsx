import type { Metadata } from "next";
import { ChainWatchWorkspace } from "@/components/chain/chain-watch-workspace";
import { hasPermission } from "@/lib/auth/authorization";
import { getChainWatchWorkspace } from "@/lib/chain-watch/chain-watch-store";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessAssignment } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Chain Watch Schedule" };

export default async function ChainWatchPage() {
  await requireLicensedPage();
  const [telemetry, roster, actor, connection] = await Promise.all([
    getWorkspaceTelemetry(),
    getFactionRoster(),
    getCurrentActor(),
    getConfiguredTornConnection(),
  ]);
  const [workspace, assignment] = await Promise.all([
    getChainWatchWorkspace(telemetry.faction?.id ?? null),
    getFactionAccessAssignment(connection?.factionId ?? null, actor.tornUserId),
  ]);
  const canManage = isPlatformOwner(actor) || Boolean(assignment && assignment.status === "ACTIVE" && hasPermission(assignment.role, "chain:manage"));

  return <ChainWatchWorkspace telemetry={telemetry} workspace={workspace} rosterResult={roster} canManage={canManage} />;
}
