import type { Metadata } from "next";
import { ArrowLeft, BadgeCheck, CircleDollarSign, FileCheck2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChainPaymentControl } from "@/components/chain/chain-payment-control";
import { ContributionTable } from "@/components/chain/contribution-table";
import { ExportButton } from "@/components/ui/action-controls";
import { calculateChainRewardPreview, getChainSettlement } from "@/lib/rewards/chain-settlement";
import { getRewardWorkspace } from "@/lib/rewards/reward-store";
import { getChainReportView } from "@/lib/torn/workspace-data-service";

interface ChainReportPageProps { params: Promise<{ chainId: string }>; }

export async function generateMetadata({ params }: ChainReportPageProps): Promise<Metadata> { const { chainId } = await params; return { title: `Chain ${chainId}` }; }

export default async function ChainReportPage({ params }: ChainReportPageProps) {
  const { chainId } = await params;
  const id = Number.parseInt(chainId, 10);
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== chainId) notFound();
  const result = await getChainReportView(id);
  const report = result.data;
  if (!report) return <div className="page-stack"><Link href="/chains" className="back-link"><ArrowLeft size={15} /> Back to chain history</Link><section className="data-section"><div className="table-empty report-unavailable"><FileCheck2 size={24} /><strong>Chain report unavailable</strong><p>{result.message}</p></div></section></div>;

  const [workspace, settlement] = await Promise.all([getRewardWorkspace(report.factionId), getChainSettlement(report.factionId, report.id)]);
  const preview = settlement ?? calculateChainRewardPreview(report, workspace);
  const memberRewards = Object.fromEntries(preview.members.map((member) => [member.tornUserId, { amount: member.amount, tierLabel: member.tierLabel }]));
  const maxHits = Math.max(1, ...report.contributions.map((member) => member.hits));

  return <div className="page-stack">
    <Link href="/chains" className="back-link"><ArrowLeft size={15} /> Back to chain history</Link>
    <header className="report-header"><div><span className="report-header__status"><FileCheck2 size={15} /> Torn chain report</span><p className="eyebrow">Completed {formatDate(report.endedAt)}</p><h1>Chain #{report.id}</h1><p>Contribution values come from Torn API v2. Rewards are calculated from the named, saved scheme version below.</p></div><div className="page-header__actions"><ChainPaymentControl chainId={report.id} preview={preview} settlement={settlement} /><ExportButton filename={`chainward-chain-${report.id}.csv`} rows={report.contributions.map((member) => ({ rank: member.rank, player: member.name, tornId: member.tornId, chainHits: member.hits, contribution: `${member.contribution.toFixed(2)}%`, respect: member.respect, reward: memberRewards[member.tornId]?.amount ?? "Not calculated", rewardUnit: preview.rewardUnit ?? "", rewardTier: memberRewards[member.tornId]?.tierLabel ?? "" }))} /></div></header>
    <section className="report-overview"><div className="report-overview__primary"><small>Final chain</small><strong>{report.hits.toLocaleString()}</strong><span>hits</span></div><div><small>Duration</small><strong>{formatDuration(report.endedAt - report.startedAt)}</strong><span>{formatTime(report.startedAt)} – {formatTime(report.endedAt)} TCT</span></div><div><small>Contributors</small><strong>{report.contributorCount}</strong><span>Torn attacker records</span></div><div><small>Respect gained</small><strong>{report.respect.toFixed(2)}</strong><span>Reported by Torn</span></div><div><small>Reward liability</small><strong>{preview.available ? preview.totalAmount.toLocaleString() : "—"}</strong><span>{preview.rewardUnit ?? "Configure a scheme"}</span></div></section>

    <section className={settlement?.status === "PAID" ? "reward-calculation-summary reward-calculation-summary--paid" : "reward-calculation-summary"}>
      <header><span>{settlement?.status === "PAID" ? <BadgeCheck size={22} /> : <CircleDollarSign size={22} />}</span><div><p className="eyebrow">{settlement?.status === "PAID" ? "Immutable paid snapshot" : "Reward calculation"}</p><h2>{preview.available ? `${preview.schemeName} · version ${preview.schemeVersion}` : "Reward scheme required"}</h2><p>{preview.message}</p></div></header>
      <dl><div><dt>Eligible records</dt><dd>{preview.members.length}</dd></div><div><dt>Total liability</dt><dd>{preview.available ? `${preview.totalAmount.toLocaleString()} ${preview.rewardUnit}` : "Unavailable"}</dd></div><div><dt>Payout status</dt><dd className={settlement?.status === "PAID" ? "paid-copy" : undefined}>{settlement?.status === "PAID" ? "PAID" : "Not marked"}</dd></div></dl>
    </section>

    <div className="report-grid"><section className="panel report-chart"><div className="section-heading"><div><h2>Leading contributors</h2><p>Qualifying chain hits from this Torn report</p></div></div><div className="horizontal-chart">{report.contributions.slice(0, 5).map((member) => <div className="horizontal-chart__row" key={member.tornId}><span>{member.name}</span><i><b style={{ width: `${(member.hits / maxHits) * 100}%` }} /></i><strong>{member.hits}</strong><small>{member.respect.toFixed(2)} respect</small></div>)}</div></section><section className="panel snapshot-card"><div className="section-heading"><div><h2>Report provenance</h2><p>Validated API response</p></div><span className="snapshot-lock"><ShieldCheck size={12} /> Verified</span></div><dl><div><dt>Chain ID</dt><dd>{report.id}</dd></div><div><dt>Faction ID</dt><dd>{report.factionId}</dd></div><div><dt>Started</dt><dd>{formatDateTime(report.startedAt)}</dd></div><div><dt>Completed</dt><dd>{formatDateTime(report.endedAt)}</dd></div><div><dt>Distinct targets</dt><dd>{report.targetCount}</dd></div></dl></section></div>
    <ContributionTable members={report.contributions} title="Member rewards and final contributions" emptyMessage={result.message} rewards={preview.available ? memberRewards : undefined} rewardUnit={preview.rewardUnit} payoutStatus={settlement?.status ?? null} />
  </div>;
}

function formatDate(timestamp: number): string { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(timestamp * 1_000); }
function formatTime(timestamp: number): string { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(timestamp * 1_000); }
function formatDateTime(timestamp: number): string { return `${formatDate(timestamp)}, ${formatTime(timestamp)} TCT`; }
function formatDuration(seconds: number): string { const hours = Math.floor(seconds / 3_600); const minutes = Math.floor((seconds % 3_600) / 60); return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`; }
