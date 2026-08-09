import { ArrowUpRight, CalendarDays, CheckCircle2, Clock3, Radio, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { ChainHero } from "@/components/chain/chain-hero";
import { ContributionTable } from "@/components/chain/contribution-table";
import { RecentChains } from "@/components/chain/recent-chains";
import { OperationsBrief } from "@/components/dashboard/operations-brief";
import { StatStrip } from "@/components/dashboard/stat-strip";
import { buildOperationsBrief } from "@/lib/intelligence/operations-brief";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getCompletedChainHistory, getCurrentChainReportView, getFactionRoster } from "@/lib/torn/workspace-data-service";

export const metadata = { title: "Overview" };

export default async function DashboardPage() {
  const [telemetry, currentReportResult, historyResult, rosterResult] = await Promise.all([
    getWorkspaceTelemetry(),
    getCurrentChainReportView(),
    getCompletedChainHistory(),
    getFactionRoster(),
  ]);
  const report = currentReportResult.data;
  const history = historyResult.data;
  const brief = buildOperationsBrief({
    telemetry,
    report,
    reportAvailable: currentReportResult.available,
    history,
    historyAvailable: historyResult.available,
    roster: rosterResult.data,
    rosterAvailable: rosterResult.available,
  });
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date());

  return <div className="page-stack">
    <header className="dashboard-greeting"><div><p className="eyebrow">{date}</p><h1>Chain command centre</h1><p>{telemetry.source === "live" ? "Verified faction and chain data from Torn API v2." : "Connect a Torn API key to load your faction workspace."}</p></div><div className="dashboard-greeting__actions"><Link className="button button--secondary" href="/chains"><CalendarDays size={16} /> View history</Link><Link className="button button--primary" href="/live-chain">Open live chain <ArrowUpRight size={16} /></Link></div></header>
    <ChainHero key={telemetry.checkedAt} telemetry={telemetry} />
    <OperationsBrief brief={brief} />
    <StatStrip telemetry={telemetry} report={report} history={history} />
    <div className="dashboard-grid">
      <ContributionTable members={report?.contributions ?? []} compact title="Current matching chain report" emptyMessage={currentReportResult.message} />
      <aside className="panel payout-summary data-provenance-card"><div className="section-heading"><div><h2>Data provenance</h2><p>No estimated operational values</p></div><span className="panel-icon"><ShieldCheck size={18} /></span></div><div className="provenance-list"><div><span><Radio size={15} /></span><p><strong>Current chain</strong><small>{telemetry.source === "live" ? "Verified from /faction/chain" : "Unavailable until connected"}</small></p>{telemetry.source === "live" && <CheckCircle2 size={14} />}</div><div><span><Clock3 size={15} /></span><p><strong>Current contributions</strong><small>{report ? `Matched to Torn report #${report.id}` : currentReportResult.message}</small></p>{report && <CheckCircle2 size={14} />}</div><div><span><CalendarDays size={15} /></span><p><strong>Completed chains</strong><small>{historyResult.available ? `${history.length} records returned by Torn` : historyResult.message}</small></p>{historyResult.available && <CheckCircle2 size={14} />}</div></div><Link href="/connect" className="panel-link">Review API connection <ArrowUpRight size={14} /></Link></aside>
    </div>
    <RecentChains chains={history} message={historyResult.message} />
  </div>;
}
