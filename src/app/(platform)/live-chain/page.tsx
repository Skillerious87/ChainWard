import type { Metadata } from "next";
import { LiveChainWorkspace } from "@/components/chain/live-chain-workspace";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getCurrentChainReportView } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Active Chain" };

export default async function LiveChainPage() {
  await requireLicensedPage();
  const [telemetry, report] = await Promise.all([getWorkspaceTelemetry(), getCurrentChainReportView()]);
  return <LiveChainWorkspace telemetry={telemetry} report={report.data} reportMessage={report.message} />;
}
