import "server-only";

import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { requireActiveFactionLicense } from "@/lib/licensing/guards";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";
import { getCurrentActor } from "./current-actor";
import { getFactionAccessWorkspace } from "./faction-access-store";
import { AuthorizationError, requirePermission, type FactionRole, type Permission } from "./authorization";
import { isPlatformOwner } from "./platform-owner";

export async function requireFactionPermission(permission: Permission) {
  const [actor, telemetry] = await Promise.all([getCurrentActor(), getWorkspaceTelemetry()]);
  if (!actor.tornUserId || telemetry.source !== "live" || !telemetry.faction) {
    throw new AuthorizationError("Connect a verified Torn faction before performing this action.");
  }
  await requireActiveFactionLicense(telemetry.faction.id);
  if (isPlatformOwner(actor)) return { actor, faction: telemetry.faction, role: "OWNER" as const };

  const access = await getFactionAccessWorkspace(telemetry.faction.id);
  if (!access.databaseAvailable) throw new AuthorizationError("The application access registry is unavailable, so this change was blocked.");
  const assignment = access.assignments.find((item) => item.tornUserId === actor.tornUserId && item.status === "ACTIVE");
  if (!assignment) throw new AuthorizationError("You do not have active application access for this faction.");

  // A stored assignment is not proof of current membership. Without this check
  // a member who leaves or is removed from the Torn faction keeps operating the
  // workspace until somebody notices and revokes the row by hand.
  await requireCurrentRosterMembership(actor.tornUserId);

  const role: FactionRole = assignment.role;
  requirePermission(role, permission);
  return { actor, faction: telemetry.faction, role };
}

/**
 * Denies only on a definite answer. If Torn cannot confirm the roster at all we
 * do not know that the member left, and turning an upstream outage into a
 * lockout for every delegated operator would be worse than the risk it avoids.
 */
async function requireCurrentRosterMembership(tornUserId: number): Promise<void> {
  const roster = await getFactionRoster();
  if (!roster.available) return;
  if (roster.data.some((member) => member.tornId === tornUserId)) return;
  throw new AuthorizationError("You are no longer in the verified faction roster, so workspace access was refused.");
}
