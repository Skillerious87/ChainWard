import type { Metadata } from "next";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { getDatabaseStatus } from "@/lib/data/database-status";
import { getFactionAccessSummary } from "@/lib/licensing/faction-access";
import { redactLockedTelemetry } from "@/lib/licensing/telemetry";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [telemetry, database] = await Promise.all([getWorkspaceTelemetry(), getDatabaseStatus()]);
  const access = await getFactionAccessSummary(telemetry.faction?.id ?? null);
  return <WorkspaceSettings telemetry={redactLockedTelemetry(telemetry, access)} database={database} />;
}
