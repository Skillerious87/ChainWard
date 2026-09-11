import type { Metadata } from "next";
import { LiveChainWorkspace } from "@/components/chain/live-chain-workspace";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getBestChainTarget } from "@/lib/targets/best-target";
import { getCurrentChainReportView } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Active Chain" };

export default async function LiveChainPage() {
  await requireLicensedPage();
  const [report, bestTarget] = await Promise.all([
    getCurrentChainReportView(),
    getBestChainTarget(),
  ]);
  return <LiveChainWorkspace report={report.data} reportMessage={report.message} bestTarget={bestTarget} />;
}
