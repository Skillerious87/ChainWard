import type { Metadata } from "next";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { getDatabaseStatus } from "@/lib/data/database-status";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [telemetry, database] = await Promise.all([getWorkspaceTelemetry(), getDatabaseStatus()]);
  return <WorkspaceSettings telemetry={telemetry} database={database} />;
}
