"use client";

import { Radio } from "lucide-react";
import { useMemo, useState } from "react";
import { ExportButton, MenuButton } from "@/components/ui/action-controls";
import { PageHeader } from "@/components/ui/page-header";
import { useLiveWorkspaceTelemetry } from "@/components/shell/live-workspace-telemetry";
import { notify } from "@/lib/client-actions";
import type { TornChainReportView } from "@/lib/torn/workspace-types";
import { ChainHero } from "./chain-hero";
import { ContributionTable } from "./contribution-table";

type ViewMode = "comfortable" | "compact" | "risk";
const viewOptions = [
  { label: "Comfortable rows", value: "comfortable", description: "Show every report field" },
  { label: "Compact rows", value: "compact", description: "Fit more contributors on screen" },
  { label: "At-risk status", value: "risk", description: "Show hospital and unavailable roster states" },
] as const;

export function LiveChainWorkspace({ report, reportMessage }: { report: TornChainReportView | null; reportMessage: string }) {
  const { telemetry } = useLiveWorkspaceTelemetry();
  const [viewMode, setViewMode] = useState<ViewMode>("comfortable");
  const members = useMemo(() => viewMode === "risk" ? (report?.contributions ?? []).filter((member) => member.status !== "Okay") : (report?.contributions ?? []), [report, viewMode]);
  function changeView(value: string): void { const next = value as ViewMode; setViewMode(next); const selection = viewOptions.find((option) => option.value === next); notify({ title: `${selection?.label ?? "View"} enabled`, description: selection?.description, tone: "info" }); }

  // Torn keeps serving the most recent chain report after a chain ends, so the
  // same rows describe a live chain or a finished one. Labelling them "current"
  // in both cases contradicted the "No active chain" state shown right above.
  const live = telemetry.chain?.state === "active";
  const reportLabel = live ? "Matching Torn report" : "Last completed chain report";
  const tableTitle = viewMode === "risk"
    ? "At-risk roster states"
    : live ? "Live report contributors" : `Final contributors · chain #${report?.id ?? "—"}`;

  return <div className="page-stack">
    <PageHeader eyebrow="Live operations" title="Active chain" description={live ? "Live chain fields and the matching report retrieved from Torn API v2." : "Torn reports no chain in progress. The most recent completed report is shown below."} actions={<><ExportButton filename="chainward-live-contributions.csv" label="Export" rows={members.map((member) => ({ rank: member.rank, player: member.name, tornId: member.tornId, chainHits: member.hits, contribution: `${member.contribution.toFixed(2)}%`, respect: member.respect, status: member.status ?? "Unavailable" }))} /><MenuButton label="View options" icon="settings" selected={viewMode} onSelect={changeView} reflectSelection={false} className="button button--secondary" options={viewOptions} /></>} />
    <div className={`notice-bar ${report ? (live ? "notice-bar--info" : "notice-bar--muted") : "notice-bar--warning"}`}><Radio size={16} /><span><strong>{report ? `${reportLabel} #${report.id}.` : "No matching chain report."}</strong> {report ? `${report.hits.toLocaleString()} recorded hits from ${report.contributorCount} contributor${report.contributorCount === 1 ? "" : "s"}. Rows count qualifying leave, mug, and hospitalize attacks.` : reportMessage}</span></div>
    <ChainHero detailed />
    <ContributionTable members={members} compact={viewMode === "compact"} title={tableTitle} emptyMessage={reportMessage} />
  </div>;
}
