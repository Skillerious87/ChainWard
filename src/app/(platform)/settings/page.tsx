import type { Metadata } from "next";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { hasPermission } from "@/lib/auth/authorization";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessAssignment } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { getDatabaseStatus } from "@/lib/data/database-status";
import { localTestingEnabled } from "@/lib/data/local-database";
import { getFactionAccessSummary } from "@/lib/licensing/faction-access";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { redactLockedTelemetry } from "@/lib/licensing/telemetry";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [telemetry, database, actor] = await Promise.all([getWorkspaceTelemetry(), getDatabaseStatus(), getCurrentActor()]);
  const factionId = telemetry.faction?.id ?? null;
  const owner = isPlatformOwner(actor);
  // Local licence controls remain available to the exact platform owner.
  // Everyone else must satisfy the normal licence and player-faction binding.
  if (!owner) await requireLicensedPage();
  const [access, assignment] = await Promise.all([
    getFactionAccessSummary(factionId),
    owner ? Promise.resolve(null) : getFactionAccessAssignment(factionId, actor.tornUserId),
  ]);
  const canMonitorMembers = access.state === "active" && (owner || Boolean(assignment && hasPermission(assignment.role, "members:manage")));
  const workspaceAuthorized = access.state === "active" && (owner || Boolean(assignment));
  // Only the exact platform owner can retain Settings while deliberately
  // testing a locked local workspace.
  const licenceTesting = process.env.NODE_ENV !== "production"
    && localTestingEnabled()
    && !process.env.DATABASE_URL?.trim()
    && owner
    ? { locked: access.state !== "active", label: access.label, factionName: telemetry.faction?.name ?? null }
    : null;
  return <WorkspaceSettings telemetry={redactLockedTelemetry(telemetry, access, workspaceAuthorized)} database={database} canMonitorMembers={canMonitorMembers} licenceTesting={licenceTesting} />;
}
