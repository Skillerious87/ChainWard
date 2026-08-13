import type { Metadata } from "next";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { hasPermission } from "@/lib/auth/authorization";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessAssignment } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { getDatabaseStatus } from "@/lib/data/database-status";
import { localTestingEnabled } from "@/lib/data/local-database";
import { getFactionAccessSummary } from "@/lib/licensing/faction-access";
import { redactLockedTelemetry } from "@/lib/licensing/telemetry";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [telemetry, database, actor] = await Promise.all([getWorkspaceTelemetry(), getDatabaseStatus(), getCurrentActor()]);
  const factionId = telemetry.faction?.id ?? null;
  const owner = isPlatformOwner(actor);
  const [access, assignment] = await Promise.all([
    getFactionAccessSummary(factionId),
    owner ? Promise.resolve(null) : getFactionAccessAssignment(factionId, actor.tornUserId),
  ]);
  const canMonitorMembers = access.state === "active" && (owner || Boolean(assignment && hasPermission(assignment.role, "members:manage")));
  // Settings is deliberately not licence-gated, so it stays reachable while the
  // workspace is locked — which is what makes it the right home for a control
  // that has to be able to unlock it again.
  const licenceTesting = process.env.NODE_ENV !== "production"
    && localTestingEnabled()
    && !process.env.DATABASE_URL?.trim()
    && owner
    ? { locked: access.state !== "active", label: access.label, factionName: telemetry.faction?.name ?? null }
    : null;
  return <WorkspaceSettings telemetry={redactLockedTelemetry(telemetry, access)} database={database} canMonitorMembers={canMonitorMembers} licenceTesting={licenceTesting} />;
}
