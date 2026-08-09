import "server-only";

import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getCurrentActor } from "./current-actor";
import { getFactionAccessWorkspace } from "./faction-access-store";
import { AuthorizationError, requirePermission, type FactionRole, type Permission } from "./authorization";
import { isPlatformOwner } from "./platform-owner";

export async function requireFactionPermission(permission: Permission) {
  const [actor, telemetry] = await Promise.all([getCurrentActor(), getWorkspaceTelemetry()]);
  if (!actor.tornUserId || telemetry.source !== "live" || !telemetry.faction) {
    throw new AuthorizationError("Connect a verified Torn faction before performing this action.");
  }
  if (isPlatformOwner(actor)) return { actor, faction: telemetry.faction, role: "OWNER" as const };

  const access = await getFactionAccessWorkspace(telemetry.faction.id);
  if (!access.databaseAvailable) throw new AuthorizationError("The application access registry is unavailable, so this change was blocked.");
  const assignment = access.assignments.find((item) => item.tornUserId === actor.tornUserId);
  if (!assignment || assignment.status !== "ACTIVE") throw new AuthorizationError("You do not have active application access for this faction.");
  const role: FactionRole = assignment.role;
  requirePermission(role, permission);
  return { actor, faction: telemetry.faction, role };
}
