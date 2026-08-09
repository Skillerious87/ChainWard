"use client";

import { Radio } from "lucide-react";
import { useMemo, useState } from "react";
import { ExportButton, MenuButton } from "@/components/ui/action-controls";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/lib/client-actions";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";
import type { TornChainReportView } from "@/lib/torn/workspace-types";
import { ChainHero } from "./chain-hero";
import { ContributionTable } from "./contribution-table";

type ViewMode = "comfortable" | "compact" | "risk";
const viewOptions = [
  { label: "Comfortable rows", value: "comfortable", description: "Show every report field" },
  { label: "Compact rows", value: "compact", description: "Fit more contributors on screen" },
  { label: "At-risk status", value: "risk", description: "Show hospital and unavailable roster states" },
] as const;

export function LiveChainWorkspace({ telemetry, report, reportMessage }: { telemetry: WorkspaceTelemetry; report: TornChainReportView | null; reportMessage: string }) {
  const [viewMode, setViewMode] = useState<ViewMode>("comfortable");
  const members = useMemo(() => viewMode === "risk" ? (report?.contributions ?? []).filter((member) => member.status !== "Okay") : (report?.contributions ?? []), [report, viewMode]);
  function changeView(value: string): void { const next = value as ViewMode; setViewMode(next); const selection = viewOptions.find((option) => option.value === next); notify({ title: `${selection?.label ?? "View"} enabled`, description: selection?.description, tone: "info" }); }
  return <div className="page-stack">
    <PageHeader eyebrow="Live operations" title="Active chain" description="Current chain fields and matching report data retrieved from Torn API v2." actions={<><ExportButton filename="chainward-live-contributions.csv" label="Export" rows={members.map((member) => ({ rank: member.rank, player: member.name, tornId: member.tornId, chainHits: member.hits, contribution: `${member.contribution.toFixed(2)}%`, respect: member.respect, status: member.status ?? "Unavailable" }))} /><MenuButton label="View options" icon="settings" selected={viewMode} onSelect={changeView} reflectSelection={false} className="button button--secondary" options={viewOptions} /></>} />
    <div className={`notice-bar ${report ? "notice-bar--info" : "notice-bar--warning"}`}><Radio size={16} /><span><strong>{report ? `Matching Torn report #${report.id}.` : "No matching current report."}</strong> {report ? "Contribution rows use qualifying leave, mug, and hospitalize attacks from the report." : reportMessage}</span></div>
    <ChainHero key={telemetry.checkedAt} telemetry={telemetry} detailed />
    <ContributionTable members={members} compact={viewMode === "compact"} title={viewMode === "risk" ? "At-risk roster states" : "Current report contributors"} emptyMessage={reportMessage} />
  </div>;
}
