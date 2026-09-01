import "server-only";

import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { requireActiveFactionLicense } from "@/lib/licensing/guards";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { getCurrentActor } from "./current-actor";
import { getFactionAccessAssignment } from "./faction-access-store";
import { AuthorizationError, requirePermission, type FactionRole, type Permission } from "./authorization";
import { isPlatformOwner } from "./platform-owner";

export async function requireFactionPermission(permission: Permission) {
  const [actor, connection] = await Promise.all([getCurrentActor(), getConfiguredTornConnection()]);
  if (!actor.tornUserId || !connection) {
    throw new AuthorizationError("Connect a verified Torn faction before performing this action.");
  }
  if (connection.tornUserId !== actor.tornUserId) {
    throw new AuthorizationError("Your verified Torn player and faction no longer match this connection. Reconnect before continuing.");
  }
  const faction = await connectedFactionIdentity(connection);
  const license = requireActiveFactionLicense(faction.id);
  if (isPlatformOwner(actor)) {
    await license;
    return { actor, faction, role: "OWNER" as const };
  }

  // The license and the actor's narrow assignment query are independent. The
  // former implementation loaded every assignment and twenty audit events,
  // then waited for it only after the license query had finished.
  const [, assignment] = await Promise.all([
    license,
    getFactionAccessAssignment(faction.id, actor.tornUserId),
  ]);
  if (!assignment) throw new AuthorizationError("You do not have active application access for this faction.");

  const role: FactionRole = assignment.role;
  requirePermission(role, permission);

  // A stored assignment is not proof of current membership. Without this check
  // a member who leaves or is removed from the Torn faction keeps operating the
  // workspace until somebody notices and revokes the row by hand.
  await requireCurrentRosterMembership(actor.tornUserId);

  return { actor, faction, role };
}

async function connectedFactionIdentity(connection: Awaited<ReturnType<typeof getConfiguredTornConnection>>) {
  if (!connection) throw new AuthorizationError("Connect a verified Torn faction before performing this action.");
  if (connection.factionName && connection.factionTag !== null) {
    return { id: connection.factionId, name: connection.factionName, tag: connection.factionTag };
  }

  // Temporary sessions from the previous release did not include the faction
  // label. They expire within twelve hours, and use the old Torn lookup only
  // until the user reconnects or the cookie naturally rolls over.
  const telemetry = await getWorkspaceTelemetry();
  if (telemetry.source !== "live" || !telemetry.faction || telemetry.faction.id !== connection.factionId) {
    throw new AuthorizationError("Your verified Torn faction could not be restored. Reconnect before continuing.");
  }
  return { id: telemetry.faction.id, name: telemetry.faction.name, tag: telemetry.faction.tag };
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
