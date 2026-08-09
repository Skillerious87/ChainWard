import type { Metadata } from "next";
import { UnlockWorkspace } from "@/components/licensing/unlock-workspace";
import { getFactionAccessSummary } from "@/lib/licensing/faction-access";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const metadata: Metadata = { title: "Unlock Chainward" };

export default async function UnlockPage() {
  const telemetry = await getWorkspaceTelemetry();
  const access = await getFactionAccessSummary(telemetry.faction?.id ?? null);
  return <UnlockWorkspace factionId={telemetry.faction?.id ?? null} factionName={telemetry.faction?.name ?? null} access={access} />;
}
