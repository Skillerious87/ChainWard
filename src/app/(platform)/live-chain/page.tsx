import type { Metadata } from "next";
import { LiveChainWorkspace } from "@/components/chain/live-chain-workspace";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getCurrentChainReportView } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Active Chain" };

export default async function LiveChainPage() {
  await requireLicensedPage();
  // The persistent shell already has the live chain. Reports stream into their
  // own boundary, and the target watcher verifies suggestions independently.
  // Neither request should keep the chain timer behind the route spinner.
  return <LiveChainWorkspace report={getCurrentChainReportView()} />;
}
