"use client";

import { Radio } from "lucide-react";
import { Suspense, use, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAppearancePreferences } from "@/lib/appearance-preferences";
import { ExportButton, MenuButton } from "@/components/ui/action-controls";
import { PageHeader } from "@/components/ui/page-header";
import { PageSpinner } from "@/components/ui/page-spinner";
import { useLiveWorkspaceTelemetry } from "@/components/shell/live-workspace-telemetry";
import { notify } from "@/lib/client-actions";
import type { TornChainReportView, TornDataResult } from "@/lib/torn/workspace-types";
import { ChainHero } from "./chain-hero";
import { ContributionTable } from "./contribution-table";

type ViewMode = "comfortable" | "compact" | "risk";
type ReportPromise = Promise<TornDataResult<TornChainReportView | null>>;
const viewOptions = [
  { label: "Comfortable rows", value: "comfortable", description: "Show every report field" },
  { label: "Compact rows", value: "compact", description: "Fit more contributors on screen" },
  { label: "At-risk status", value: "risk", description: "Show hospital and unavailable roster states" },
] as const;

export function LiveChainWorkspace({ report }: { report: ReportPromise }) {
  const { telemetry } = useLiveWorkspaceTelemetry();
  const router = useRouter();
  const preferences = useAppearancePreferences();
  const [refreshing, startRefresh] = useTransition();
  const chainKey = `${telemetry.chain?.id ?? 0}:${telemetry.chain?.state ?? "idle"}`;
  const previousChainKey = useRef(chainKey);
  useEffect(() => {
    if (previousChainKey.current === chainKey) return;
    previousChainKey.current = chainKey;
    startRefresh(() => router.refresh());
  }, [chainKey, router]);
  // Refresh only the report here. Target verification has its own cancellable
  // watcher, so it neither blocks navigation nor runs twice on every visit.
  useEffect(() => {
    if (!preferences.autoRefresh || refreshing) return;
    let lastRefreshAt = Date.now();
    const refresh = () => {
      if (!navigator.onLine) return;
      lastRefreshAt = Date.now();
      startRefresh(() => router.refresh());
    };
    const refreshOnFocus = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefreshAt < preferences.refreshIntervalSeconds * 1_000) return;
      refresh();
    };
    const interval = window.setInterval(refresh, preferences.refreshIntervalSeconds * 1_000);
    document.addEventListener("visibilitychange", refreshOnFocus);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      window.removeEventListener("online", refresh);
    };
  }, [preferences.autoRefresh, preferences.refreshIntervalSeconds, refreshing, router]);
  const [viewMode, setViewMode] = useState<ViewMode>("comfortable");
  function changeView(value: string): void { const next = value as ViewMode; setViewMode(next); const selection = viewOptions.find((option) => option.value === next); notify({ title: `${selection?.label ?? "View"} enabled`, description: selection?.description, tone: "info" }); }

  const live = telemetry.chain?.state === "active";
  return <div className="page-stack">
    <PageHeader eyebrow="Live operations" title="Active chain" description={live ? "Live chain fields and the matching report retrieved from Torn API v2." : "Torn reports no chain in progress. The most recent completed report is shown below."} actions={<><Suspense fallback={null}><ReportExport report={report} viewMode={viewMode} /></Suspense><MenuButton label="View options" icon="settings" selected={viewMode} onSelect={changeView} reflectSelection={false} className="button button--secondary" options={viewOptions} /></>} />
    <ChainHero detailed onRefresh={() => startRefresh(() => router.refresh())} />
    <Suspense fallback={<PageSpinner label="Loading chain contributors" />}>
      <LiveChainReport report={report} viewMode={viewMode} />
    </Suspense>
  </div>;
}

function useMatchingReport(promise: ReportPromise, viewMode: ViewMode) {
  const result = use(promise);
  const { telemetry } = useLiveWorkspaceTelemetry();
  // Hide the old chain immediately while the new server report is loading.
  const report = telemetry.chain?.state === "active" && result.data?.id !== telemetry.chain.id ? null : result.data;
  const members = viewMode === "risk" ? (report?.contributions ?? []).filter((member) => member.status !== "Okay") : (report?.contributions ?? []);
  return { report, members, result, live: telemetry.chain?.state === "active" };
}

function ReportExport({ report: promise, viewMode }: { report: ReportPromise; viewMode: ViewMode }) {
  const { members } = useMatchingReport(promise, viewMode);
  return <ExportButton filename="chainward-live-contributions.csv" label="Export" rows={members.map((member) => ({ rank: member.rank, player: member.name, tornId: member.tornId, chainHits: member.hits, contribution: `${member.contribution.toFixed(2)}%`, respect: member.respect, status: member.status ?? "Unavailable" }))} />;
}

function LiveChainReport({ report: promise, viewMode }: { report: ReportPromise; viewMode: ViewMode }) {
  const { report, members, result, live } = useMatchingReport(promise, viewMode);
  // Torn keeps serving the most recent chain report after a chain ends, so the
  // same rows describe a live chain or a finished one. Labelling them "current"
  // in both cases contradicted the "No active chain" state shown right above.
  const reportLabel = live ? "Matching Torn report" : "Last completed chain report";
  const tableTitle = viewMode === "risk"
    ? "At-risk roster states"
    : live ? "Live report contributors" : report ? `Final contributors · chain #${report.id}` : "Chain contributors";
  const emptyMessage = !report && result.data ? "Retrieving contributors for the current chain…" : result.message;

  return <>
    <div className={`notice-bar ${report ? (live ? "notice-bar--info" : "notice-bar--muted") : "notice-bar--warning"}`}><Radio size={16} /><span><strong>{report ? `${reportLabel} #${report.id}.` : "No matching chain report."}</strong> {report ? `${report.hits.toLocaleString("en-GB")} recorded hits from ${report.contributorCount} contributor${report.contributorCount === 1 ? "" : "s"}. Rows count qualifying leave, mug, and hospitalize attacks.` : emptyMessage}</span></div>
    <ContributionTable members={members} compact={viewMode === "compact"} title={tableTitle} emptyMessage={viewMode === "risk" && report ? "No contributors currently have an at-risk roster status." : emptyMessage} />
  </>;
}
