import type { Metadata } from "next";
import { FactionAccessWorkspace } from "@/components/faction/faction-access-workspace";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessWorkspace } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Faction Access" };

export default async function FactionPage() {
  await requireLicensedPage();
  const [telemetry, roster, actor] = await Promise.all([getWorkspaceTelemetry(), getFactionRoster(), getCurrentActor()]);
  const access = await getFactionAccessWorkspace(telemetry.faction?.id ?? null);
  const canManage = isPlatformOwner(actor);
  return <FactionAccessWorkspace telemetry={telemetry} rosterResult={roster} access={access} canManage={canManage} />;
}
