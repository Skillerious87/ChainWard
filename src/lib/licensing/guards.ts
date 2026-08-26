import "server-only";

import { redirect } from "next/navigation";
import { AuthorizationError } from "@/lib/auth/authorization";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessAssignment } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";
import { getFactionAccessSummary } from "./faction-access";

export async function requireLicensedPage(): Promise<void> {
  const [actor, telemetry, connection] = await Promise.all([getCurrentActor(), getWorkspaceTelemetry(), getConfiguredTornConnection()]);
  if (!actor.tornUserId || telemetry.source !== "live" || !telemetry.faction || !connection) redirect("/connect");
  if (connection.tornUserId !== actor.tornUserId || connection.factionId !== telemetry.faction.id) redirect("/connect");
  const access = await getFactionAccessSummary(telemetry.faction.id);
  if (access.state !== "active") redirect("/unlock");
  if (isPlatformOwner(actor)) return;
  const assignment = await getFactionAccessAssignment(telemetry.faction.id, actor.tornUserId);
  if (!assignment) redirect("/unlock");
  const roster = await getFactionRoster();
  if (roster.available && !roster.data.some((member) => member.tornId === actor.tornUserId)) redirect("/unlock");
}

export async function requireActiveFactionLicense(tornFactionId: number): Promise<void> {
  const access = await getFactionAccessSummary(tornFactionId);
  if (access.state !== "active") {
    throw new AuthorizationError("This feature is locked until the faction has active Chainward access.");
  }
}
