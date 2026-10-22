import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { AuthorizationError } from "@/lib/auth/authorization";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessAssignment } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";
import { getFactionAccessSummary } from "./faction-access";

export const requireLicensedPage = cache(async (): Promise<void> => {
  const [actor, connection] = await Promise.all([getCurrentActor(), getConfiguredTornConnection()]);
  if (!actor.tornUserId || !connection) redirect("/connect");
  if (connection.tornUserId !== actor.tornUserId) redirect("/connect");
  const owner = isPlatformOwner(actor);
  // These reads share the trusted connection and do not depend on each other.
  // Check every result before the page can render any protected content.
  const rosterPromise = owner ? Promise.resolve(null) : getFactionRoster();
  const [access, assignment] = await Promise.all([
    getFactionAccessSummary(connection.factionId),
    owner ? Promise.resolve(null) : getFactionAccessAssignment(connection.factionId, actor.tornUserId),
  ]);
  if (access.state !== "active") redirect("/unlock");
  if (owner) return;
  if (!assignment) redirect("/unlock");
  const roster = await rosterPromise;
  if (roster?.available && !roster.data.some((member) => member.tornId === actor.tornUserId)) redirect("/unlock");
});

export async function requireActiveFactionLicense(tornFactionId: number): Promise<void> {
  const access = await getFactionAccessSummary(tornFactionId);
  if (access.state !== "active") {
    throw new AuthorizationError("This feature is locked until the faction has active Chainward access.");
  }
}
