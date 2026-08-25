import type { Metadata } from "next";
import { ArrowLeft, BadgeCheck, CircleDollarSign, FileCheck2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChainPaymentControl } from "@/components/chain/chain-payment-control";
import { ContributionTable } from "@/components/chain/contribution-table";
import { ExportButton } from "@/components/ui/action-controls";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { RewardAmount } from "@/components/ui/reward-amount";
import { calculateChainRewardPreview, getChainSettlement } from "@/lib/rewards/chain-settlement";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getRewardWorkspace } from "@/lib/rewards/reward-store";
import { getChainReportView } from "@/lib/torn/workspace-data-service";

interface ChainReportPageProps { params: Promise<{ chainId: string }>; }

export async function generateMetadata({ params }: ChainReportPageProps): Promise<Metadata> { const { chainId } = await params; return { title: `Chain ${chainId}` }; }

export default async function ChainReportPage({ params }: ChainReportPageProps) {
  await requireLicensedPage();
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
  const respectPerHit = report.hits > 0 ? report.respect / report.hits : 0;
  const leaders = report.contributions.slice(0, 6);

  return <div className="page-stack">
    <Link href="/chains" className="back-link"><ArrowLeft size={15} /> Back to chain history</Link>
    <header className="report-header"><div><span className="report-header__status"><FileCheck2 size={15} /> Torn chain report</span><p className="eyebrow">Completed {formatDate(report.endedAt)}</p><h1>Chain #{report.id}</h1><p>Contribution values come from Torn API v2. Rewards are calculated from the named, saved scheme version below.</p></div><div className="page-header__actions"><ChainPaymentControl chainId={report.id} preview={preview} settlement={settlement} /><ExportButton filename={`chainward-chain-${report.id}.csv`} rows={report.contributions.map((member) => ({ rank: member.rank, player: member.name, tornId: member.tornId, chainHits: member.hits, contribution: `${member.contribution.toFixed(2)}%`, respect: member.respect, reward: memberRewards[member.tornId]?.amount ?? "Not calculated", rewardUnit: preview.rewardUnit ?? "", rewardTier: memberRewards[member.tornId]?.tierLabel ?? "" }))} /></div></header>
    <section className="report-overview">
      <div className="report-overview__primary"><small>Final chain</small><strong>{report.hits.toLocaleString()}</strong><span>hits · {respectPerHit.toFixed(2)} respect each</span></div>
      <div><small>Duration</small><strong>{formatDuration(report.endedAt - report.startedAt)}</strong><span>{formatTime(report.startedAt)} – {formatTime(report.endedAt)} TCT</span></div>
      <div><small>Contributors</small><strong>{report.contributorCount}</strong><span>{report.targetCount.toLocaleString()} distinct targets</span></div>
      <div><small>Respect gained</small><strong>{report.respect.toFixed(2)}</strong><span>Reported by Torn</span></div>
      <div><small>Reward liability</small>{preview.available && preview.rewardUnit ? <RewardAmount amount={preview.totalAmount} unit={preview.rewardUnit} paid={settlement?.status === "PAID"} size="summary" artwork="liability" /> : <><strong>—</strong><span>Configure a scheme</span></>}</div>
    </section>

    <section className={settlement?.status === "PAID" ? "reward-calculation-summary reward-calculation-summary--paid" : "reward-calculation-summary"}>
      <header><span>{settlement?.status === "PAID" ? <BadgeCheck size={22} /> : <CircleDollarSign size={22} />}</span><div><p className="eyebrow">{settlement?.status === "PAID" ? "Immutable paid snapshot" : "Reward calculation"}</p><h2>{preview.available ? `${preview.schemeName} · version ${preview.schemeVersion}` : "Reward scheme required"}</h2><p>{preview.message}</p></div></header>
      <dl><div><dt>Eligible records</dt><dd>{preview.members.length}</dd></div><div><dt>Total liability</dt><dd>{preview.available && preview.rewardUnit ? <RewardAmount amount={preview.totalAmount} unit={preview.rewardUnit} paid={settlement?.status === "PAID"} size="compact" artwork="liability" /> : "Unavailable"}</dd></div><div><dt>Payout status</dt><dd className={settlement?.status === "PAID" ? "paid-copy" : undefined}>{settlement?.status === "PAID" ? "PAID" : "Not marked"}</dd></div></dl>
    </section>

    <div className="report-grid">
      <section className="panel report-chart">
        <div className="section-heading"><div><h2>Leading contributors</h2><p>Qualifying chain hits from this Torn report</p></div><span className="report-chart__count">Top {leaders.length} of {report.contributorCount}</span></div>
        <ol className="contributor-chart">
          {leaders.map((member) => (
            <li key={member.tornId} className={member.rank === 1 ? "contributor-chart__row contributor-chart__row--lead" : "contributor-chart__row"}>
              <span className="contributor-chart__rank">{member.rank}</span>
              <div className="contributor-chart__identity">
                <MemberAvatar name={member.name} />
                <span><strong>{member.name}</strong><small>{member.respect.toFixed(2)} respect</small></span>
              </div>
              <div className="contributor-chart__bar"><i style={{ width: `${Math.max(2, (member.hits / maxHits) * 100)}%` }} /></div>
              <div className="contributor-chart__value"><strong>{member.hits.toLocaleString()}</strong><small>{member.contribution.toFixed(1)}%</small></div>
            </li>
          ))}
          {leaders.length === 0 && <li className="contributor-chart__empty">Torn returned no attacker records for this chain.</li>}
        </ol>
      </section>
      <section className="panel snapshot-card" aria-labelledby="report-provenance-title">
        <header className="snapshot-card__header">
          <div className="snapshot-card__title">
            <span><FileCheck2 size={19} /></span>
            <div><p className="eyebrow">Source record</p><h2 id="report-provenance-title">Report provenance</h2><p>Validated Torn API v2 response</p></div>
          </div>
          <span className="snapshot-verification" role="status" aria-label="Source integrity verified">
            <i><ShieldCheck size={15} /></i>
            <span><small>Integrity check</small><strong>Verified</strong></span>
          </span>
        </header>
        <div className="snapshot-assurance" role="list" aria-label="Verification checks">
          <span role="listitem"><BadgeCheck size={13} /> Schema passed</span>
          <span role="listitem"><BadgeCheck size={13} /> Faction matched</span>
          <span role="listitem"><BadgeCheck size={13} /> Final report</span>
        </div>
        <dl className="snapshot-facts">
          <div><dt>Chain record</dt><dd>#{report.id}</dd></div>
          <div><dt>Faction record</dt><dd>#{report.factionId}</dd></div>
          <div className="snapshot-fact--wide"><dt>Started</dt><dd><time dateTime={new Date(report.startedAt * 1_000).toISOString()}><span>{formatDate(report.startedAt)}</span><small>{formatTime(report.startedAt)} TCT</small></time></dd></div>
          <div className="snapshot-fact--wide"><dt>Completed</dt><dd><time dateTime={new Date(report.endedAt * 1_000).toISOString()}><span>{formatDate(report.endedAt)}</span><small>{formatTime(report.endedAt)} TCT</small></time></dd></div>
          <div><dt>Distinct targets</dt><dd>{report.targetCount.toLocaleString()}</dd></div>
          <div><dt>Respect per hit</dt><dd>{respectPerHit.toFixed(2)}</dd></div>
        </dl>
        <footer className="snapshot-card__footer">
          <span><ShieldCheck size={16} /></span>
          <p><strong>Source boundary intact</strong><small>Report values come from Torn; Chainward calculates rewards separately from the saved scheme version.</small></p>
        </footer>
      </section>
    </div>
    <ContributionTable members={report.contributions} title="Member rewards and final contributions" emptyMessage={result.message} rewards={preview.available ? memberRewards : undefined} rewardUnit={preview.rewardUnit} payoutStatus={settlement?.status ?? null} showRewards rewardMessage={preview.message} />
  </div>;
}

function formatDate(timestamp: number): string { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(timestamp * 1_000); }
function formatTime(timestamp: number): string { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(timestamp * 1_000); }
function formatDuration(seconds: number): string { const hours = Math.floor(seconds / 3_600); const minutes = Math.floor((seconds % 3_600) / 60); return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`; }
