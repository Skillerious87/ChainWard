"use client";

import {
  Activity,
  ArrowUpRight,
  Award,
  BarChart3,
  Clock3,
  History,
  RadioTower,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ExportButton } from "@/components/ui/action-controls";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { PageHeader } from "@/components/ui/page-header";
import { summarizeChainHistory, summarizeRoster } from "@/lib/intelligence/analytics";
import type { TornChainHistoryItem, TornChainReportView, TornDataResult, TornRosterMember } from "@/lib/torn/workspace-types";

type ChartMetric = "hits" | "respect" | "duration";
type Range = 6 | 12 | 24 | 100;

interface AnalyticsWorkspaceProps {
  historyResult: TornDataResult<TornChainHistoryItem[]>;
  reportResult: TornDataResult<TornChainReportView | null>;
  rosterResult: TornDataResult<TornRosterMember[]>;
}

const ranges: Array<{ value: Range; label: string }> = [
  { value: 6, label: "6 chains" },
  { value: 12, label: "12 chains" },
  { value: 24, label: "24 chains" },
  { value: 100, label: "All returned" },
];

const metrics: Array<{ value: ChartMetric; label: string }> = [
  { value: "hits", label: "Hits" },
  { value: "respect", label: "Respect" },
  { value: "duration", label: "Duration" },
];

export function AnalyticsWorkspace({ historyResult, reportResult, rosterResult }: AnalyticsWorkspaceProps) {
  const [range, setRange] = useState<Range>(12);
  const [metric, setMetric] = useState<ChartMetric>("hits");
  const history = historyResult.data;
  const report = reportResult.data;
  const roster = rosterResult.data;
  const selectedHistory = useMemo(() => history.slice(0, range), [history, range]);
  const chainSummary = useMemo(() => summarizeChainHistory(selectedHistory), [selectedHistory]);
  const rosterSummary = useMemo(() => summarizeRoster(roster, rosterResult.checkedAt), [roster, rosterResult.checkedAt]);
  const topPositions = rosterSummary.positions.slice(0, 6);
  const trendTone = chainSummary.trendPercent === null ? "neutral" : chainSummary.trendPercent >= 5 ? "positive" : chainSummary.trendPercent <= -5 ? "negative" : "neutral";
  const TrendIcon = trendTone === "positive" ? TrendingUp : trendTone === "negative" ? TrendingDown : BarChart3;

  return <div className="page-stack analytics-workspace">
    <PageHeader
      eyebrow="Verified faction intelligence"
      title="Analytics"
      description="Explore chain performance, roster readiness, and participation using only validated Torn responses."
      actions={<ExportButton filename="chainward-torn-analytics.csv" label="Export history" rows={history.map((chain) => ({ chainId: chain.id, hits: chain.hits, respect: chain.respect, durationMinutes: Math.round((chain.endedAt - chain.startedAt) / 60), start: new Date(chain.startedAt * 1_000).toISOString(), end: new Date(chain.endedAt * 1_000).toISOString() }))} />}
    />

    <section className={`analytics-brief analytics-brief--${trendTone}`}>
      <span><TrendIcon size={23} /></span>
      <div><p className="eyebrow">Performance brief · selected range</p><h2>{chainSummary.headline}</h2><p>{chainSummary.summary}</p></div>
      <div className="analytics-brief__meta"><small>Signal basis</small><strong>{chainSummary.sampleSize} verified chains</strong><span>{chainSummary.trendPercent === null ? "More history needed for trend" : `${formatSigned(chainSummary.trendPercent)} vs prior sample`}</span></div>
    </section>

    <div className="analytics-control-bar">
      <div><span>Analysis range</span><div className="segmented-control">{ranges.map((option) => <button key={option.value} className={range === option.value ? "segmented-control__active" : undefined} onClick={() => setRange(option.value)}>{option.label}</button>)}</div></div>
      <p><ShieldCheck size={13} /> No extrapolation · metrics recalculate from the selected returned records</p>
    </div>

    <section className="analytics-stat-grid">
      <AnalyticsStat icon={History} label="Chains analysed" value={historyResult.available ? chainSummary.sampleSize.toLocaleString() : "—"} detail={`${history.length} returned in total`} />
      <AnalyticsStat icon={Target} label="Average chain" value={historyResult.available ? Math.round(chainSummary.averageHits).toLocaleString() : "—"} detail="Verified final hits" />
      <AnalyticsStat icon={Award} label="Best returned" value={historyResult.available ? chainSummary.bestChain?.hits.toLocaleString() ?? "—" : "—"} detail={chainSummary.bestChain ? `Chain #${chainSummary.bestChain.id}` : historyResult.message} />
      <AnalyticsStat icon={Clock3} label="Average duration" value={historyResult.available ? formatDuration(chainSummary.averageDurationSeconds) : "—"} detail="Start to completion" />
      <AnalyticsStat icon={ShieldCheck} label="Consistency" value={chainSummary.consistencyPercent === null ? "—" : `${chainSummary.consistencyPercent.toFixed(0)}%`} detail="Variation around average" />
    </section>

    <div className="analytics-dashboard-grid">
      <section className="panel analytics-trend-panel">
        <div className="section-heading analytics-panel-heading"><div><h2>Chain performance trend</h2><p>{selectedHistory.length} completed chains · oldest to newest</p></div><div className="segmented-control segmented-control--compact">{metrics.map((option) => <button key={option.value} className={metric === option.value ? "segmented-control__active" : undefined} onClick={() => setMetric(option.value)}>{option.label}</button>)}</div></div>
        {selectedHistory.length > 0 ? <ChainTrendChart history={selectedHistory.toReversed()} metric={metric} /> : <AnalyticsEmpty icon={History} title="No completed chains returned" message={historyResult.message} />}
        <div className="analytics-trend-footer"><span><small>Average hits</small><strong>{Math.round(chainSummary.averageHits).toLocaleString()}</strong></span><span><small>Respect per hit</small><strong>{chainSummary.respectPerHit.toFixed(2)}</strong></span><span><small>Average respect</small><strong>{chainSummary.averageRespect.toFixed(2)}</strong></span><span><small>Recent movement</small><strong className={`analytics-value--${trendTone}`}>{chainSummary.trendPercent === null ? "Baseline pending" : formatSigned(chainSummary.trendPercent)}</strong></span></div>
      </section>

      <section className="panel roster-readiness-panel">
        <div className="section-heading"><div><h2>Roster readiness</h2><p>Current state and recent Torn activity</p></div><span className="analytics-panel-icon"><UsersRound size={17} /></span></div>
        <div className="roster-readiness-score"><div className="analytics-donut" style={{ "--progress": `${rosterSummary.okayPercent}%` } as React.CSSProperties}><div><strong>{rosterResult.available ? `${rosterSummary.okayPercent.toFixed(0)}%` : "—"}</strong><span>Status Okay</span></div></div><dl><div><dt>Ready now</dt><dd>{rosterSummary.okay} <small>/ {rosterSummary.total}</small></dd></div><div><dt>Other states</dt><dd>{Math.max(0, rosterSummary.total - rosterSummary.okay)}</dd></div></dl></div>
        <div className="activity-windows"><ActivityWindow label="Active in 15 minutes" value={rosterSummary.active15Minutes} total={rosterSummary.total} /><ActivityWindow label="Active in 1 hour" value={rosterSummary.activeHour} total={rosterSummary.total} /><ActivityWindow label="Active in 24 hours" value={rosterSummary.activeDay} total={rosterSummary.total} /></div>
        <div className="status-breakdown">{rosterSummary.statuses.slice(0, 4).map((status) => <div key={status.label}><i className={`member-state-dot member-state-dot--${statusClass(status.label)}`} /><span>{status.label}</span><strong>{status.count}</strong><em>{status.percent.toFixed(0)}%</em></div>)}</div>
      </section>
    </div>

    <div className="analytics-dashboard-grid analytics-dashboard-grid--secondary">
      <section className="panel analytics-leaders-panel">
        <div className="section-heading"><div><h2>Current report leaders</h2><p>{report ? `Matching Torn report #${report.id}` : "Current-chain participation"}</p></div>{report && <span className="active-badge"><RadioTower size={12} /> Verified report</span>}</div>
        {report ? <div className="analytics-leader-list">{report.contributions.slice(0, 6).map((member, index) => <article key={member.tornId}><span className="analytics-leader-rank">{index + 1}</span><MemberAvatar name={member.name} /><div><strong>{member.name}</strong><small>{member.hits.toLocaleString()} qualifying hits · {member.respect.toFixed(2)} respect</small></div><i><b style={{ width: `${Math.min(100, member.contribution)}%` }} /></i><em>{member.contribution.toFixed(1)}%</em></article>)}</div> : <AnalyticsEmpty icon={Activity} title="No matching current report" message={reportResult.message} action={{ label: "Open live chain", href: "/live-chain" }} />}
      </section>

      <section className="panel position-mix-panel">
        <div className="section-heading"><div><h2>Position mix</h2><p>Current faction roster structure</p></div><span className="analytics-panel-icon"><UsersRound size={17} /></span></div>
        <div className="position-mix-list">{topPositions.map((position) => <div key={position.label}><p><span>{position.label}</span><strong>{position.count}</strong></p><i><b style={{ width: `${position.percent}%` }} /></i><small>{position.percent.toFixed(0)}% of roster</small></div>)}{topPositions.length === 0 && <AnalyticsEmpty icon={UsersRound} title="Roster structure unavailable" message={rosterResult.message} />}</div>
      </section>
    </div>

    <section className="analytics-source-strip" aria-label="Analytics source coverage">
      <SourceState label="Completed chains" available={historyResult.available} message={historyResult.message} />
      <SourceState label="Current report" available={reportResult.available && Boolean(report)} message={reportResult.message} />
      <SourceState label="Faction roster" available={rosterResult.available} message={rosterResult.message} />
    </section>
  </div>;
}

function AnalyticsStat({ icon: Icon, label, value, detail }: { icon: typeof History; label: string; value: string; detail: string }) {
  return <article><span><Icon size={17} /></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function ChainTrendChart({ history, metric }: { history: TornChainHistoryItem[]; metric: ChartMetric }) {
  const width = 900;
  const height = 270;
  const bounds = { left: 54, right: 20, top: 24, bottom: 47 };
  const values = history.map((chain) => metricValue(chain, metric));
  const maximum = Math.max(1, ...values) * 1.08;
  const chartWidth = width - bounds.left - bounds.right;
  const chartHeight = height - bounds.top - bounds.bottom;
  const point = (value: number, index: number) => ({ x: bounds.left + (history.length === 1 ? chartWidth / 2 : (index / (history.length - 1)) * chartWidth), y: bounds.top + chartHeight - (value / maximum) * chartHeight });
  const points = values.map(point);
  const line = points.map((item, index) => `${index === 0 ? "M" : "L"}${item.x.toFixed(1)},${item.y.toFixed(1)}`).join(" ");
  const area = points.length ? `${line} L${points.at(-1)!.x},${bounds.top + chartHeight} L${points[0]!.x},${bounds.top + chartHeight} Z` : "";
  const ticks = [0, .25, .5, .75, 1];
  return <div className="analytics-chart-wrap"><svg className="analytics-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metricLabel(metric)} by completed chain`}><defs><linearGradient id={`area-${metric}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".2"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs>{ticks.map((tick) => { const y = bounds.top + chartHeight - tick * chartHeight; return <g key={tick}><line className="analytics-chart-gridline" x1={bounds.left} x2={width - bounds.right} y1={y} y2={y}/><text className="analytics-chart-axis" x={bounds.left - 10} y={y + 4} textAnchor="end">{formatMetric(maximum * tick, metric, true)}</text></g>; })}<path className="analytics-chart-area" d={area} fill={`url(#area-${metric})`} /><path className="analytics-chart-line" d={line} />{points.map((item, index) => <g className="analytics-chart-point" key={history[index]!.id}><circle cx={item.x} cy={item.y} r="4"/><circle cx={item.x} cy={item.y} r="9" opacity="0"><title>{`Chain #${history[index]!.id}: ${formatMetric(values[index]!, metric)}`}</title></circle>{showAxisLabel(index, history.length) && <text x={item.x} y={height - 17} textAnchor="middle">#{history[index]!.id}</text>}</g>)}</svg></div>;
}

function ActivityWindow({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = total ? (value / total) * 100 : 0;
  return <div><p><span>{label}</span><strong>{value}<small> / {total}</small></strong></p><i><b style={{ width: `${percent}%` }} /></i></div>;
}

function AnalyticsEmpty({ icon: Icon, title, message, action }: { icon: typeof History; title: string; message: string; action?: { label: string; href: "/live-chain" } }) {
  return <div className="analytics-empty"><span><Icon size={21} /></span><div><strong>{title}</strong><p>{message}</p></div>{action && <Link className="button button--quiet" href={action.href}>{action.label}<ArrowUpRight size={14} /></Link>}</div>;
}

function SourceState({ label, available, message }: { label: string; available: boolean; message: string }) {
  return <div><span className={`source-state source-state--${available ? "ready" : "attention"}`}><i />{available ? "Verified" : "Attention"}</span><p><strong>{label}</strong><small>{message}</small></p></div>;
}

function metricValue(chain: TornChainHistoryItem, metric: ChartMetric): number {
  if (metric === "respect") return chain.respect;
  if (metric === "duration") return Math.max(0, chain.endedAt - chain.startedAt) / 3_600;
  return chain.hits;
}

function metricLabel(metric: ChartMetric): string {
  return metric === "hits" ? "Final hits" : metric === "respect" ? "Respect" : "Duration";
}

function formatMetric(value: number, metric: ChartMetric, compact = false): string {
  if (metric === "duration") return `${value.toFixed(compact && value >= 10 ? 0 : 1)}h`;
  if (metric === "respect") return value.toFixed(compact ? 0 : 2);
  return compact && value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : Math.round(value).toLocaleString();
}

function showAxisLabel(index: number, count: number): boolean {
  if (count <= 8) return true;
  return index === 0 || index === count - 1 || index % 2 === 0;
}

function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function statusClass(value: string): string {
  const status = value.toLowerCase();
  if (status.includes("okay")) return "okay";
  if (status.includes("hospital")) return "hospital";
  if (status.includes("travel")) return "travel";
  return "other";
}
