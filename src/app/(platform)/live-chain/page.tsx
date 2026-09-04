import type { Metadata } from "next";
import { LiveChainWorkspace } from "@/components/chain/live-chain-workspace";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getCurrentChainReportView } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Active Chain" };

export default async function LiveChainPage() {
  await requireLicensedPage();
  const report = await getCurrentChainReportView();
  return <LiveChainWorkspace report={report.data} reportMessage={report.message} />;
}
