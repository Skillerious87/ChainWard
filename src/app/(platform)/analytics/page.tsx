import type { Metadata } from "next";
import { AnalyticsWorkspace } from "@/components/analytics/analytics-workspace";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getCompletedChainHistory, getCurrentChainReportView, getFactionRoster } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  await requireLicensedPage();
  const [historyResult, reportResult, rosterResult] = await Promise.all([getCompletedChainHistory(), getCurrentChainReportView(), getFactionRoster()]);
  return <AnalyticsWorkspace historyResult={historyResult} reportResult={reportResult} rosterResult={rosterResult} />;
}
