import { Activity, ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2, Clock3, Radio, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import Link from "next/link";
import { ChainHero } from "@/components/chain/chain-hero";
import { ContributionTable } from "@/components/chain/contribution-table";
import { RecentChains } from "@/components/chain/recent-chains";
import { OperationsBrief } from "@/components/dashboard/operations-brief";
import { StatStrip } from "@/components/dashboard/stat-strip";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { buildOperationsBrief } from "@/lib/intelligence/operations-brief";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getCompletedChainHistory, getCurrentChainReportView, getFactionRoster } from "@/lib/torn/workspace-data-service";

export const metadata = { title: "Overview" };

export default async function DashboardPage() {
  const [telemetry, currentReportResult, historyResult, rosterResult, actor] = await Promise.all([
    getWorkspaceTelemetry(),
    getCurrentChainReportView(),
    getCompletedChainHistory(),
    getFactionRoster(),
    getCurrentActor(),
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
  const connected = telemetry.source === "live";
  const displayName = actor.tornUserId > 0 ? actor.name : "there";
  const factionName = telemetry.faction?.name ?? "Your faction";
  const chainState = telemetry.chain?.state;
  const chainTitle = chainState === "active" ? "A chain is live" : chainState === "cooldown" ? "Cooldown in progress" : connected ? "Ready for the next chain" : "Connection needed";
  const chainDetail = chainState === "active" && telemetry.chain
    ? `${telemetry.chain.current.toLocaleString()} of ${telemetry.chain.maximum.toLocaleString()} hits recorded by Torn.`
    : chainState === "cooldown"
      ? "The workspace will return to live tracking automatically."
      : connected
        ? "Everything is quiet. This is a good moment to prepare."
        : "Connect a restricted Torn key to bring the workspace online.";
  const checkedTime = formatCheckedTime(telemetry.checkedAt);

  return <div className="page-stack">
    <section className="overview-welcome" aria-labelledby="overview-welcome-title">
      <span className="overview-welcome__glow" aria-hidden="true" />
      <div className="overview-welcome__copy">
        <div className="overview-welcome__kicker"><span><Sparkles size={13} /> Workspace overview</span><time>{date}</time></div>
        <h1 id="overview-welcome-title">Welcome back, <span>{displayName}.</span></h1>
        <p>{connected ? `${factionName} is connected and ready. Here’s the clearest view of what deserves your attention today.` : "Let’s bring your faction workspace online and turn every chain into a clear, coordinated operation."}</p>
        <div className="overview-welcome__actions">
          <Link className="button button--primary overview-welcome__primary" href={connected ? "/live-chain" : "/connect"}>{connected ? "Open live chain" : "Connect Torn API"}<ArrowUpRight size={16} /></Link>
          <Link className="button button--secondary" href="/chains"><CalendarDays size={16} /> View chain history</Link>
        </div>
        <div className="overview-welcome__assurance" aria-label="Workspace assurances">
          <span><ShieldCheck size={14} /> Verified Torn data</span>
          <span><Radio size={14} /> Server-side connection</span>
          <span><CheckCircle2 size={14} /> No estimated live values</span>
        </div>
      </div>

      <aside className={`overview-pulse overview-pulse--${chainState ?? "offline"}`} aria-label="Workspace pulse">
        <header><span><i /> Workspace pulse</span><time dateTime={telemetry.checkedAt}>Checked {checkedTime}</time></header>
        <div className="overview-pulse__focus">
          <span><Activity size={21} /></span>
          <div><small>Right now</small><strong>{chainTitle}</strong><p>{chainDetail}</p></div>
        </div>
        <dl>
          <div><dt><UsersRound size={14} /> Faction members</dt><dd>{telemetry.faction?.members?.toLocaleString() ?? "—"}</dd></div>
          <div><dt><ShieldCheck size={14} /> Data source</dt><dd>{connected ? "Verified live" : "Offline"}</dd></div>
        </dl>
        <Link href={chainState === "active" ? "/live-chain" : "/rewards"}>{chainState === "active" ? "View the live operation" : "Prepare reward schemes"}<ArrowRight size={14} /></Link>
      </aside>
    </section>

    <header className="overview-section-heading"><div><p className="eyebrow">Live operations</p><h2>What’s happening right now</h2></div><p>Verified operational data, refreshed directly from Torn.</p></header>
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

function formatCheckedTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unavailable";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date);
}
