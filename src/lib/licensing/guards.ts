import "server-only";

import { redirect } from "next/navigation";
import { AuthorizationError } from "@/lib/auth/authorization";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionAccessSummary } from "./faction-access";

export async function requireLicensedPage(): Promise<void> {
  const [actor, telemetry] = await Promise.all([getCurrentActor(), getWorkspaceTelemetry()]);
  if (!actor.tornUserId || telemetry.source !== "live" || !telemetry.faction) redirect("/connect");
  const access = await getFactionAccessSummary(telemetry.faction.id);
  if (access.state !== "active") redirect("/unlock");
}

export async function requireActiveFactionLicense(tornFactionId: number): Promise<void> {
  const access = await getFactionAccessSummary(tornFactionId);
  if (access.state !== "active") {
    throw new AuthorizationError("This feature is locked until the faction has active Chainward access.");
  }
}
