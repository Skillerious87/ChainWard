"use client";

import {
  AlertTriangle,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CircleGauge,
  Clock3,
  DatabaseZap,
  Layers3,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState, type CSSProperties } from "react";
import { TornUserLink } from "@/components/ui/torn-user-link";
import type { PayoutLedgerEntry } from "@/lib/rewards/payout-store";

type LedgerView = "ALL" | "ACTION" | "PAID" | "HELD" | "WAIVED";
type LedgerSort = "RECENT" | "CHAIN" | "MEMBER" | "AMOUNT";

const PAGE_SIZE = 25;
const views: ReadonlyArray<{ value: LedgerView; label: string }> = [
  { value: "ALL", label: "All records" },
  { value: "ACTION", label: "Needs action" },
  { value: "PAID", label: "Paid" },
  { value: "HELD", label: "Held" },
  { value: "WAIVED", label: "Waived" },
];

interface ChainRollup {
  chainId: number;
  total: number;
  paid: number;
  waived: number;
  held: number;
  approved: number;
  pending: number;
  openTotals: Map<string, number>;
}

export interface PayoutLedgerAnalysis {
  paid: number;
  approved: number;
  pending: number;
  held: number;
  waived: number;
  resolved: number;
  settlementRate: number;
  paidTotals: Map<string, number>;
  openTotals: Map<string, number>;
  distinctMembers: number;
  missingTiers: number;
  paidWithoutRecorder: number;
  chains: ChainRollup[];
  latestProcessedAt: string | null;
}

export function analysePayoutLedger(entries: readonly PayoutLedgerEntry[]): PayoutLedgerAnalysis {
  const statusCounts = { paid: 0, approved: 0, pending: 0, held: 0, waived: 0 };
  const paidTotals = new Map<string, number>();
  const openTotals = new Map<string, number>();
  const memberIds = new Set<number>();
  const chains = new Map<number, ChainRollup>();
  let missingTiers = 0;
  let paidWithoutRecorder = 0;
  let latestProcessedAt: string | null = null;

  for (const entry of entries) {
    memberIds.add(entry.tornUserId);
    if (!entry.tierLabel) missingTiers += 1;
    if (entry.status === "PAID") {
      statusCounts.paid += 1;
      addTotal(paidTotals, entry.rewardUnit, entry.amount);
      if (!entry.processedBy) paidWithoutRecorder += 1;
    } else if (entry.status === "APPROVED") {
      statusCounts.approved += 1;
      addTotal(openTotals, entry.rewardUnit, entry.amount);
    } else if (entry.status === "HELD") {
      statusCounts.held += 1;
      addTotal(openTotals, entry.rewardUnit, entry.amount);
    } else if (entry.status === "WAIVED") {
      statusCounts.waived += 1;
    } else {
      statusCounts.pending += 1;
      addTotal(openTotals, entry.rewardUnit, entry.amount);
    }
    if (entry.processedAt && (!latestProcessedAt || entry.processedAt > latestProcessedAt)) latestProcessedAt = entry.processedAt;

    const chain = chains.get(entry.chainId) ?? { chainId: entry.chainId, total: 0, paid: 0, waived: 0, held: 0, approved: 0, pending: 0, openTotals: new Map<string, number>() };
    chain.total += 1;
    if (entry.status === "PAID") chain.paid += 1;
    else if (entry.status === "WAIVED") chain.waived += 1;
    else {
      if (entry.status === "HELD") chain.held += 1;
      else if (entry.status === "APPROVED") chain.approved += 1;
      else chain.pending += 1;
      addTotal(chain.openTotals, entry.rewardUnit, entry.amount);
    }
    chains.set(entry.chainId, chain);
  }

  const resolved = statusCounts.paid + statusCounts.waived;
  return {
    ...statusCounts,
    resolved,
    settlementRate: entries.length ? (resolved / entries.length) * 100 : 0,
    paidTotals,
    openTotals,
    distinctMembers: memberIds.size,
    missingTiers,
    paidWithoutRecorder,
    chains: [...chains.values()].toSorted((left, right) => right.held - left.held || openCount(right) - openCount(left) || right.chainId - left.chainId),
    latestProcessedAt,
  };
}

export function PayoutLedger({ entries, message, databaseAvailable = true }: { entries: PayoutLedgerEntry[]; message: string; databaseAvailable?: boolean }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [view, setView] = useState<LedgerView>("ALL");
  const [unit, setUnit] = useState("ALL");
  const [sort, setSort] = useState<LedgerSort>("RECENT");
  const [page, setPage] = useState(0);
  const analysis = useMemo(() => analysePayoutLedger(entries), [entries]);
  const units = useMemo(() => [...new Set(entries.map((entry) => entry.rewardUnit))].toSorted(), [entries]);

  const filtered = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    return entries
      .filter((entry) => matchesView(entry, view)
        && (unit === "ALL" || entry.rewardUnit === unit)
        && (!normalized || `${entry.memberName} ${entry.tornUserId} ${entry.chainId} ${entry.tierLabel ?? ""} ${entry.status} ${entry.processedBy?.name ?? ""}`.toLowerCase().includes(normalized)))
      .toSorted((left, right) => compareEntries(left, right, sort));
  }, [deferredQuery, entries, sort, unit, view]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const latestActivity = analysis.latestProcessedAt
    ? new Date(analysis.latestProcessedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "No processing activity";

  function changeView(next: LedgerView): void { setView(next); setPage(0); }
  function clearFilters(): void { setQuery(""); setView("ALL"); setUnit("ALL"); setSort("RECENT"); setPage(0); }

  return <>
    <section className="payout-intelligence" aria-labelledby="payout-intelligence-title">
      <header className="payout-intelligence__header">
        <span className="payout-intelligence__mark"><Sparkles size={20} /></span>
        <div>
          <p className="eyebrow">Settlement intelligence</p>
          <h2 id="payout-intelligence-title">{postureTitle(analysis, entries.length, databaseAvailable)}</h2>
          <p>{postureDescription(analysis, entries.length, message, databaseAvailable)}</p>
        </div>
        <span className="payout-intelligence__activity"><Clock3 size={13} /><span><small>Latest acknowledgement</small><strong>{latestActivity}</strong></span></span>
      </header>

      <div className="payout-intelligence__kpis">
        <article>
          <span className="payout-score-ring" style={{ "--progress": `${analysis.settlementRate}%` } as CSSProperties}><strong>{analysis.settlementRate.toFixed(0)}%</strong></span>
          <div><small>Settlement rate</small><strong>{analysis.resolved.toLocaleString()} / {entries.length.toLocaleString()}</strong><em>Paid or formally waived</em></div>
        </article>
        <article><span><ShieldAlert size={18} /></span><div><small>Requires attention</small><strong>{(analysis.pending + analysis.approved + analysis.held).toLocaleString()}</strong><em>{analysis.held ? `${analysis.held} held for review` : analysis.approved ? `${analysis.approved} approved, awaiting payment` : "No held records"}</em></div></article>
        <article><span><CircleDollarSign size={18} /></span><div><small>Outstanding liability</small><strong>{formatTotals(analysis.openTotals)}</strong><em>{analysis.openTotals.size > 1 ? "Kept separate by reward unit" : "Pending, approved, and held"}</em></div></article>
        <article><span><Users size={18} /></span><div><small>Ledger coverage</small><strong>{analysis.distinctMembers.toLocaleString()} <b>members</b></strong><em>{analysis.chains.length.toLocaleString()} chain{analysis.chains.length === 1 ? "" : "s"} represented</em></div></article>
      </div>

      <div className="payout-lifecycle" aria-label="Payout status distribution">
        <div className="payout-lifecycle__bar" aria-hidden="true">
          {entries.length > 0 && <>
            <i className="payout-lifecycle__paid" style={{ width: percent(analysis.paid, entries.length) }} />
            <i className="payout-lifecycle__approved" style={{ width: percent(analysis.approved, entries.length) }} />
            <i className="payout-lifecycle__pending" style={{ width: percent(analysis.pending, entries.length) }} />
            <i className="payout-lifecycle__held" style={{ width: percent(analysis.held, entries.length) }} />
            <i className="payout-lifecycle__waived" style={{ width: percent(analysis.waived, entries.length) }} />
          </>}
        </div>
        <div className="payout-lifecycle__legend">
          <LifecycleItem tone="paid" label="Paid" count={analysis.paid} />
          <LifecycleItem tone="approved" label="Approved" count={analysis.approved} />
          <LifecycleItem tone="pending" label="Pending" count={analysis.pending} />
          <LifecycleItem tone="held" label="Held" count={analysis.held} />
          <LifecycleItem tone="waived" label="Waived" count={analysis.waived} />
        </div>
      </div>

      <div className="payout-analysis-grid">
        <section className="payout-posture">
          <header><div><p className="eyebrow">Control review</p><h3>Operational posture</h3></div><span className={analysis.held || analysis.paidWithoutRecorder ? "payout-posture__state payout-posture__state--attention" : "payout-posture__state"}>{analysis.held || analysis.paidWithoutRecorder ? <AlertTriangle size={13} /> : <ShieldCheck size={13} />}{analysis.held || analysis.paidWithoutRecorder ? "Review required" : "Controls clear"}</span></header>
          <ul>
            <PostureRow tone={analysis.held ? "danger" : "clear"} title={analysis.held ? `${analysis.held} held record${analysis.held === 1 ? "" : "s"}` : "No payments on hold"} detail={analysis.held ? "Resolve the hold reason before any Torn transfer." : "No manual stop flags are present in this register."} />
            <PostureRow tone={analysis.approved ? "warning" : "clear"} title={analysis.approved ? `${analysis.approved} approved for payment` : "No approved queue"} detail={analysis.approved ? formatTotalsForStatuses(entries, ["APPROVED"]) + " awaits a paid acknowledgement." : "Nothing is sitting between approval and settlement."} />
            <PostureRow tone={analysis.paidWithoutRecorder ? "warning" : "clear"} title={analysis.paidWithoutRecorder ? `${analysis.paidWithoutRecorder} paid row${analysis.paidWithoutRecorder === 1 ? "" : "s"} without an operator` : "Recorder attribution complete"} detail={analysis.paidWithoutRecorder ? "Legacy or system acknowledgements should be reconciled during a dispute." : "Every paid row identifies the acknowledgement source."} />
            <PostureRow tone={analysis.missingTiers ? "neutral" : "clear"} title={analysis.missingTiers ? `${analysis.missingTiers} record${analysis.missingTiers === 1 ? "" : "s"} have no tier label` : "Tier provenance complete"} detail={analysis.missingTiers ? "These rows remain valid, but the reward decision is less explainable." : "Every record carries its saved reward tier."} />
          </ul>
        </section>

        <section className="payout-chain-analysis">
          <header><div><p className="eyebrow">Chain-level risk</p><h3>Unresolved settlement share</h3></div><Link href="/chains">Open chain history <span>→</span></Link></header>
          <ol>
            {analysis.chains.slice(0, 6).map((chain) => {
              const resolved = chain.paid + chain.waived;
              const unresolved = openCount(chain);
              const risk = chain.total ? (unresolved / chain.total) * 100 : 0;
              const riskTone = chain.held ? "danger" : unresolved ? "warning" : "clear";
              const riskLabel = risk > 0 && risk < 1 ? "<1%" : `${risk.toFixed(0)}%`;
              const riskAccessible = risk > 0 && risk < 1 ? "less than 1 percent" : `${risk.toFixed(0)} percent`;
              return <li key={chain.chainId}>
                <span className="payout-chain-analysis__ring" data-tone={riskTone} style={{ "--progress": `${risk}%` } as CSSProperties} aria-label={`${riskAccessible} unresolved settlement risk`} title={`${unresolved} of ${chain.total} payout records remain unresolved`}><strong>{riskLabel}</strong></span>
                <div><Link href={`/chains/${chain.chainId}`}>Chain #{chain.chainId}</Link><small>{resolved} of {chain.total} records resolved</small></div>
                <span className="payout-chain-analysis__amount"><strong>{unresolved ? formatTotals(chain.openTotals) : "Settled"}</strong><small>{chain.held ? `${chain.held} held` : chain.approved ? `${chain.approved} approved` : chain.pending ? `${chain.pending} pending` : "0% unresolved risk"}</small></span>
              </li>;
            })}
            {analysis.chains.length === 0 && <li className="payout-chain-analysis__empty"><Layers3 size={18} /><span><strong>No chain settlements yet</strong><small>Completed payout snapshots will appear here.</small></span></li>}
          </ol>
        </section>
      </div>
    </section>

    <section className="data-section professional-payout-ledger">
      <div className="payout-register-heading">
        <div><span><DatabaseZap size={18} /></span><div><p className="eyebrow">Auditable register</p><h2>Member payout ledger</h2><p>{filtered.length.toLocaleString()} of {entries.length.toLocaleString()} persisted records match this view</p></div></div>
        <span className="payout-register-heading__source"><ShieldCheck size={13} /> Persisted records only</span>
      </div>

      <div className="payout-view-tabs" role="tablist" aria-label="Ledger status view">
        {views.map((option) => <button key={option.value} role="tab" aria-selected={view === option.value} className={view === option.value ? "payout-view-tab--active" : undefined} onClick={() => changeView(option.value)}>{option.label}<span>{viewCount(option.value, analysis, entries.length)}</span></button>)}
      </div>

      <div className="payout-ledger-toolbar">
        <label className="search-field payout-ledger-search"><Search size={15} /><span className="sr-only">Search payout records</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Member, ID, chain, tier, or recorder" /></label>
        <div className="payout-ledger-filters">
          <label><span>Reward unit</span><select value={unit} onChange={(event) => { setUnit(event.target.value); setPage(0); }}><option value="ALL">All units</option>{units.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label><span>Sort by</span><select value={sort} onChange={(event) => { setSort(event.target.value as LedgerSort); setPage(0); }}><option value="RECENT">Latest activity</option><option value="CHAIN">Newest chain</option><option value="MEMBER">Member name</option><option value="AMOUNT">Highest reward</option></select></label>
          {(query || view !== "ALL" || unit !== "ALL" || sort !== "RECENT") && <button className="payout-filter-reset" onClick={clearFilters}>Reset filters</button>}
        </div>
      </div>

      <div className="table-scroll"><table className="data-table payout-ledger-table"><caption className="sr-only">Persisted member payout records with reward, status, processing time, and recorder</caption><thead><tr><th>Member</th><th>Chain</th><th>Reward decision</th><th className="numeric">Liability</th><th>Status</th><th>Timeline</th><th>Recorded by</th></tr></thead><tbody>{visible.map((entry) => <tr key={entry.id}><td><TornUserLink className="ledger-member" name={entry.memberName} tornUserId={entry.tornUserId} detail={`Torn ID ${entry.tornUserId}`} /></td><td><Link className="chain-id" href={`/chains/${entry.chainId}`}>#{entry.chainId}</Link></td><td>{entry.tierLabel ? <span className="tier-label">{entry.tierLabel}</span> : <span className="muted-value">No saved tier</span>}</td><td className="numeric"><span className="ledger-amount"><strong>{formatAmount(entry.amount)}</strong><small>{entry.rewardUnit}</small></span></td><td><span className={`payout-badge payout-badge--${statusClass(entry.status)}`}>{entry.status === "PAID" ? <BadgeCheck size={13} /> : entry.status === "WAIVED" ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}{statusLabel(entry.status)}</span></td><td><LedgerTimeline entry={entry} /></td><td><PayoutRecorder value={entry.processedBy} /></td></tr>)}</tbody></table>{visible.length === 0 && <div className="table-empty payout-ledger-empty"><CircleDollarSign size={22} /><div><strong>{entries.length ? "No records match this control view" : "No payout records yet"}</strong><span>{entries.length ? "Reset the filters or search a different member, chain, or recorder." : message}</span></div></div>}</div>
      <div className="payout-register-footer"><span>Showing {visible.length ? safePage * PAGE_SIZE + 1 : 0}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()} <small>· Payment state changes only through deliberate Chainward actions</small></span><div className="pagination"><button disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft size={14} /> Previous</button><span>Page {safePage + 1} of {pageCount}</span><button disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next <ChevronRight size={14} /></button></div></div>
    </section>
  </>;
}

function LifecycleItem({ tone, label, count }: { tone: string; label: string; count: number }) {
  return <span><i className={`payout-lifecycle__dot payout-lifecycle__dot--${tone}`} /><strong>{label}</strong><small>{count.toLocaleString()}</small></span>;
}

function PostureRow({ tone, title, detail }: { tone: "clear" | "danger" | "warning" | "neutral"; title: string; detail: string }) {
  return <li className={`payout-posture__row payout-posture__row--${tone}`}><span>{tone === "clear" ? <ShieldCheck size={15} /> : tone === "danger" ? <ShieldAlert size={15} /> : tone === "warning" ? <AlertTriangle size={15} /> : <CircleGauge size={15} />}</span><div><strong>{title}</strong><small>{detail}</small></div></li>;
}

function LedgerTimeline({ entry }: { entry: PayoutLedgerEntry }) {
  if (entry.processedAt) return <span className="ledger-date"><strong>{new Date(entry.processedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong><small>{new Date(entry.processedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · processed</small></span>;
  return <span className="ledger-date ledger-date--open"><strong>{new Date(entry.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong><small>Created · not processed</small></span>;
}

function PayoutRecorder({ value }: { value: PayoutLedgerEntry["processedBy"] }) {
  if (!value) return <span className="muted-value">System / legacy</span>;
  return <TornUserLink className="ledger-processor" name={value.name} tornUserId={value.tornUserId} avatar={false} detail="Payment recorder" />;
}

function matchesView(entry: PayoutLedgerEntry, view: LedgerView): boolean {
  if (view === "ALL") return true;
  if (view === "ACTION") return entry.status === "PENDING" || entry.status === "APPROVED" || entry.status === "HELD";
  return entry.status === view;
}

function compareEntries(left: PayoutLedgerEntry, right: PayoutLedgerEntry, sort: LedgerSort): number {
  if (sort === "CHAIN") return right.chainId - left.chainId || left.memberName.localeCompare(right.memberName);
  if (sort === "MEMBER") return left.memberName.localeCompare(right.memberName) || right.chainId - left.chainId;
  if (sort === "AMOUNT") return right.amount - left.amount || left.memberName.localeCompare(right.memberName);
  return (right.processedAt ?? right.createdAt).localeCompare(left.processedAt ?? left.createdAt) || right.chainId - left.chainId;
}

function viewCount(view: LedgerView, analysis: PayoutLedgerAnalysis, total: number): number {
  if (view === "ALL") return total;
  if (view === "ACTION") return analysis.pending + analysis.approved + analysis.held;
  return analysis[view.toLowerCase() as "paid" | "held" | "waived"];
}

function addTotal(totals: Map<string, number>, unit: string, amount: number): void { totals.set(unit, (totals.get(unit) ?? 0) + amount); }
function openCount(chain: ChainRollup): number { return chain.pending + chain.approved + chain.held; }
function percent(value: number, total: number): string { return `${total ? (value / total) * 100 : 0}%`; }
function formatAmount(value: number): string { return value.toLocaleString("en-GB", { maximumFractionDigits: 4 }); }
function formatTotals(totals: ReadonlyMap<string, number>): string {
  const values = [...totals.entries()].filter(([, amount]) => amount !== 0);
  if (!values.length) return "0";
  if (values.length <= 2) return values.map(([unit, amount]) => `${formatAmount(amount)} ${unit}`).join(" · ");
  return `${values.length} reward units`;
}
function formatTotalsForStatuses(entries: readonly PayoutLedgerEntry[], statuses: PayoutLedgerEntry["status"][]): string {
  const totals = new Map<string, number>();
  for (const entry of entries) if (statuses.includes(entry.status)) addTotal(totals, entry.rewardUnit, entry.amount);
  return formatTotals(totals);
}
function statusClass(status: PayoutLedgerEntry["status"]): string { return status.toLowerCase(); }
function statusLabel(status: PayoutLedgerEntry["status"]): string { return status.charAt(0) + status.slice(1).toLowerCase(); }
function postureTitle(analysis: PayoutLedgerAnalysis, total: number, available: boolean): string {
  if (!available) return "The payout register needs storage attention.";
  if (!total) return "The ledger is ready for its first settled chain.";
  if (analysis.held) return `${analysis.held} held payment record${analysis.held === 1 ? " needs" : "s need"} an operator decision.`;
  if (analysis.approved) return `${analysis.approved} approved reward${analysis.approved === 1 ? " is" : "s are"} ready for final acknowledgement.`;
  if (analysis.pending) return `${analysis.pending} calculated reward${analysis.pending === 1 ? " is" : "s are"} still open.`;
  return "Every recorded payout is resolved.";
}
function postureDescription(analysis: PayoutLedgerAnalysis, total: number, message: string, available: boolean): string {
  if (!available || !total) return message;
  if (analysis.held) return "Held records are surfaced first, then approved and pending liability. Reward units remain separated so unlike values are never summed together.";
  return `${analysis.resolved.toLocaleString()} of ${total.toLocaleString()} records are paid or waived. The register below preserves the member, chain, reward decision, timestamp, and recorder for dispute review.`;
}
