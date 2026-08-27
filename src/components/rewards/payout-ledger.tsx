"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CircleGauge,
  CircleMinus,
  Clock3,
  ClipboardList,
  DatabaseZap,
  Layers3,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState, type CSSProperties } from "react";
import { ExportButton } from "@/components/ui/action-controls";
import { RewardAmount } from "@/components/ui/reward-amount";
import { TornUserLink } from "@/components/ui/torn-user-link";
import type { PayoutLedgerEntry } from "@/lib/rewards/payout-store";

type LedgerView = "ALL" | "ACTION" | "PAID" | "HELD" | "WAIVED" | "NOT_ELIGIBLE";
type LedgerSort = "RECENT" | "CHAIN" | "MEMBER" | "AMOUNT";
type LedgerRange = "ALL" | "30" | "90" | "365";
type SortDirection = "asc" | "desc";
type PageSize = 10 | 25 | 50;

const views: ReadonlyArray<{ value: LedgerView; label: string }> = [
  { value: "ALL", label: "All records" },
  { value: "ACTION", label: "Needs action" },
  { value: "PAID", label: "Paid" },
  { value: "HELD", label: "Held" },
  { value: "WAIVED", label: "Waived" },
  { value: "NOT_ELIGIBLE", label: "Not eligible" },
];

interface ChainRollup {
  chainId: number;
  total: number;
  paid: number;
  waived: number;
  notEligible: number;
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
  notEligible: number;
  payable: number;
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
  const statusCounts = { paid: 0, approved: 0, pending: 0, held: 0, waived: 0, notEligible: 0 };
  const paidTotals = new Map<string, number>();
  const openTotals = new Map<string, number>();
  const memberIds = new Set<number>();
  const chains = new Map<number, ChainRollup>();
  let missingTiers = 0;
  let paidWithoutRecorder = 0;
  let latestProcessedAt: string | null = null;

  for (const entry of entries) {
    const payable = isPayable(entry);
    if (payable) memberIds.add(entry.tornUserId);
    if (!entry.tierLabel) missingTiers += 1;
    if (!payable) {
      statusCounts.notEligible += 1;
    } else if (entry.status === "PAID") {
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

    const chain = chains.get(entry.chainId) ?? { chainId: entry.chainId, total: 0, paid: 0, waived: 0, notEligible: 0, held: 0, approved: 0, pending: 0, openTotals: new Map<string, number>() };
    chain.total += 1;
    if (!payable) chain.notEligible += 1;
    else if (entry.status === "PAID") chain.paid += 1;
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
  const payable = entries.length - statusCounts.notEligible;
  return {
    ...statusCounts,
    payable,
    resolved,
    settlementRate: payable ? (resolved / payable) * 100 : entries.length ? 100 : 0,
    paidTotals,
    openTotals,
    distinctMembers: memberIds.size,
    missingTiers,
    paidWithoutRecorder,
    chains: [...chains.values()].toSorted((left, right) => right.held - left.held || openCount(right) - openCount(left) || right.chainId - left.chainId),
    latestProcessedAt,
  };
}

interface PayoutLedgerProps {
  entries: PayoutLedgerEntry[];
  message: string;
  databaseAvailable?: boolean;
  section?: "all" | "overview" | "register";
}

export function PayoutOverview(props: Omit<PayoutLedgerProps, "section">) {
  return <PayoutLedger {...props} section="overview" />;
}

export function PayoutRegister(props: Omit<PayoutLedgerProps, "section">) {
  return <PayoutLedger {...props} section="register" />;
}

export function PayoutLedger({ entries, message, databaseAvailable = true, section = "all" }: PayoutLedgerProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [view, setView] = useState<LedgerView>("ALL");
  const [unit, setUnit] = useState("ALL");
  const [range, setRange] = useState<LedgerRange>("ALL");
  const [rangeCutoff, setRangeCutoff] = useState<number | null>(null);
  const [sort, setSort] = useState<LedgerSort>("RECENT");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [page, setPage] = useState(0);
  const analysis = useMemo(() => analysePayoutLedger(entries), [entries]);
  const units = useMemo(() => [...new Set(entries.map((entry) => entry.rewardUnit))].toSorted(), [entries]);

  const filtered = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    return entries
      .filter((entry) => matchesView(entry, view)
        && (unit === "ALL" || entry.rewardUnit === unit)
        && (rangeCutoff === null || Date.parse(entry.processedAt ?? entry.createdAt) >= rangeCutoff)
        && (!normalized || `${entry.memberName} ${entry.tornUserId} ${entry.chainId} ${entry.tierLabel ?? ""} ${displayStatus(entry)} ${entry.processedBy?.name ?? ""}`.toLowerCase().includes(normalized)))
      .toSorted((left, right) => compareEntries(left, right, sort, sortDirection));
  }, [deferredQuery, entries, rangeCutoff, sort, sortDirection, unit, view]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const filteredTotals = useMemo(() => totalsForEntries(filtered), [filtered]);
  const exportRows = useMemo(() => filtered.map((entry) => ({ chainId: entry.chainId, tornUserId: entry.tornUserId, member: entry.memberName, tier: entry.tierLabel ?? "", amount: entry.amount, unit: entry.rewardUnit, paymentDue: isPayable(entry) ? "Yes" : "No", status: displayStatus(entry), createdAt: entry.createdAt, processedAt: entry.processedAt ?? "", processedBy: entry.processedBy?.name ?? "" })), [filtered]);
  const outstandingTotal = singleTotal(analysis.openTotals);
  const latestActivity = analysis.latestProcessedAt
    ? new Date(analysis.latestProcessedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "No processing activity";

  function changeView(next: LedgerView): void { setView(next); setPage(0); }
  function changeRange(next: LedgerRange): void { setRange(next); setRangeCutoff(next === "ALL" ? null : Date.now() - Number(next) * 86_400_000); setPage(0); }
  function setSortMode(next: LedgerSort): void { setSort(next); setSortDirection(next === "MEMBER" ? "asc" : "desc"); setPage(0); }
  function changeSort(next: LedgerSort): void {
    if (sort === next) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else setSortMode(next);
    setPage(0);
  }
  function clearFilters(): void { setQuery(""); setView("ALL"); setUnit("ALL"); setRange("ALL"); setRangeCutoff(null); setSort("RECENT"); setSortDirection("desc"); setPage(0); }

  return <>
    {section !== "register" && <section className="payout-intelligence payout-workspace-section" aria-labelledby="payout-intelligence-title">
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
          <div><small>Settlement rate</small><strong>{analysis.resolved.toLocaleString()} / {analysis.payable.toLocaleString()}</strong><em>{analysis.notEligible ? `${analysis.notEligible.toLocaleString()} not eligible excluded` : "Paid or formally waived"}</em></div>
        </article>
        <article><span><ShieldAlert size={18} /></span><div><small>Requires attention</small><strong>{(analysis.pending + analysis.approved + analysis.held).toLocaleString()}</strong><em>{analysis.held ? `${analysis.held} held for review` : analysis.approved ? `${analysis.approved} approved, awaiting payment` : "No held records"}</em></div></article>
        <article><span><CircleDollarSign size={18} /></span><div><small>Outstanding liability</small>{outstandingTotal ? <RewardAmount amount={outstandingTotal[1]} unit={outstandingTotal[0]} artwork="liability" size="compact" /> : <strong>{formatTotals(analysis.openTotals)}</strong>}<em>{analysis.openTotals.size > 1 ? "Kept separate by reward unit" : "Pending, approved, and held"}</em></div></article>
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
            <i className="payout-lifecycle__not-eligible" style={{ width: percent(analysis.notEligible, entries.length) }} />
          </>}
        </div>
        <div className="payout-lifecycle__legend">
          <LifecycleItem tone="paid" label="Paid" count={analysis.paid} />
          <LifecycleItem tone="approved" label="Approved" count={analysis.approved} />
          <LifecycleItem tone="pending" label="Pending" count={analysis.pending} />
          <LifecycleItem tone="held" label="Held" count={analysis.held} />
          <LifecycleItem tone="waived" label="Waived" count={analysis.waived} />
          <LifecycleItem tone="not-eligible" label="Not eligible" count={analysis.notEligible} />
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
              const payable = chain.total - chain.notEligible;
              const resolved = chain.paid + chain.waived;
              const unresolved = openCount(chain);
              const risk = payable ? (unresolved / payable) * 100 : 0;
              const riskTone = chain.held ? "danger" : unresolved ? "warning" : "clear";
              const riskLabel = risk > 0 && risk < 1 ? "<1%" : `${risk.toFixed(0)}%`;
              const riskAccessible = risk > 0 && risk < 1 ? "less than 1 percent" : `${risk.toFixed(0)} percent`;
              return <li key={chain.chainId}>
                <span className="payout-chain-analysis__ring" data-tone={riskTone} style={{ "--progress": `${risk}%` } as CSSProperties} aria-label={`${riskAccessible} unresolved settlement risk`} title={`${unresolved} of ${payable} payable records remain unresolved`}><strong>{riskLabel}</strong></span>
                <div><Link href={`/chains/${chain.chainId}`}>Chain #{chain.chainId}</Link><small>{resolved} of {payable} payable records resolved{chain.notEligible ? ` · ${chain.notEligible} not eligible` : ""}</small></div>
                <span className="payout-chain-analysis__amount"><strong>{unresolved ? formatTotals(chain.openTotals) : "Settled"}</strong><small>{chain.held ? `${chain.held} held` : chain.approved ? `${chain.approved} approved` : chain.pending ? `${chain.pending} pending` : "0% unresolved risk"}</small></span>
              </li>;
            })}
            {analysis.chains.length === 0 && <li className="payout-chain-analysis__empty"><Layers3 size={18} /><span><strong>No chain settlements yet</strong><small>Completed payout snapshots will appear here.</small></span></li>}
          </ol>
        </section>
      </div>
      <nav className="payout-overview-links" aria-label="Continue payout review">
        <Link href="/payouts/ledger"><span><ClipboardList size={17} /></span><span><strong>Inspect the register</strong><small>{(analysis.pending + analysis.approved + analysis.held).toLocaleString()} record{analysis.pending + analysis.approved + analysis.held === 1 ? "" : "s"} need attention</small></span><ChevronRight size={14} /></Link>
        <Link href="/payouts/recipients"><span><Trophy size={17} /></span><span><strong>Review recipients</strong><small>{analysis.distinctMembers.toLocaleString()} member{analysis.distinctMembers === 1 ? "" : "s"} across every reward unit</small></span><ChevronRight size={14} /></Link>
        <Link href="/payouts/corrections"><span><RotateCcw size={17} /></span><span><strong>Audit corrections</strong><small>Reasons and operators behind withdrawn acknowledgements</small></span><ChevronRight size={14} /></Link>
      </nav>
    </section>}

    {section !== "overview" && <section className="data-section professional-payout-ledger payout-workspace-section">
      <div className="payout-register-heading">
        <div><span><DatabaseZap size={18} /></span><div><p className="eyebrow">Auditable register</p><h2>Member payout ledger</h2><p>{filtered.length.toLocaleString()} of {entries.length.toLocaleString()} persisted records match this view</p></div></div>
        <span className="payout-register-heading__source"><ShieldCheck size={13} /> Persisted records only</span>
      </div>

      <div className="payout-view-tabs" role="tablist" aria-label="Ledger status view">
        {views.map((option) => <button key={option.value} role="tab" aria-selected={view === option.value} className={view === option.value ? "payout-view-tab--active" : undefined} onClick={() => changeView(option.value)}>{option.label}<span>{viewCount(option.value, analysis, entries.length)}</span></button>)}
      </div>

      <div className="payout-ledger-toolbar">
        <div className="payout-ledger-toolbar__primary">
          <label className="search-field payout-ledger-search"><Search size={15} /><span className="sr-only">Search payout records</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Member, ID, chain, tier, or recorder" /></label>
          <ExportButton filename="chainward-payout-current-view.csv" label={`Export view (${filtered.length})`} rows={exportRows} className="button button--quiet payout-ledger-export" />
        </div>
        <div className="payout-ledger-filters">
          <label><span>Date range</span><select value={range} onChange={(event) => changeRange(event.target.value as LedgerRange)}><option value="ALL">All activity</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option></select></label>
          <label><span>Reward unit</span><select value={unit} onChange={(event) => { setUnit(event.target.value); setPage(0); }}><option value="ALL">All units</option>{units.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label><span>Sort by</span><select value={sort} onChange={(event) => setSortMode(event.target.value as LedgerSort)}><option value="RECENT">Activity date</option><option value="CHAIN">Chain number</option><option value="MEMBER">Member name</option><option value="AMOUNT">Reward amount</option></select></label>
          <label><span>Rows</span><select className="payout-page-size" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as PageSize); setPage(0); }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label>
          {(query || view !== "ALL" || unit !== "ALL" || range !== "ALL" || sort !== "RECENT" || sortDirection !== "desc") && <button className="payout-filter-reset" onClick={clearFilters}>Reset view</button>}
        </div>
      </div>

      <div className="table-scroll"><table className="data-table payout-ledger-table"><caption className="sr-only">Persisted member reward decisions with eligibility, payout status, processing time, and recorder</caption><thead><tr><SortableLedgerHeader label="Member" value="MEMBER" active={sort} direction={sortDirection} onSort={changeSort} /><SortableLedgerHeader label="Chain" value="CHAIN" active={sort} direction={sortDirection} onSort={changeSort} /><th>Reward decision</th><SortableLedgerHeader label="Member reward" value="AMOUNT" active={sort} direction={sortDirection} onSort={changeSort} numeric /><th>Status</th><SortableLedgerHeader label="Timeline" value="RECENT" active={sort} direction={sortDirection} onSort={changeSort} /><th>Recorded by</th><th><span className="sr-only">Open chain</span></th></tr></thead><tbody>{visible.map((entry) => <tr key={entry.id} className={`payout-ledger-row payout-ledger-row--${statusClass(entry)}`}><td><TornUserLink className="ledger-member" name={entry.memberName} tornUserId={entry.tornUserId} detail={`Torn ID ${entry.tornUserId}`} /></td><td><Link className="chain-id" href={`/chains/${entry.chainId}`}>#{entry.chainId}</Link></td><td>{entry.tierLabel ? <span className="tier-label">{entry.tierLabel}</span> : <span className="muted-value">No saved tier</span>}</td><td className="numeric ledger-reward-cell"><RewardAmount amount={entry.amount} unit={entry.rewardUnit} paid={isPayable(entry) && entry.status === "PAID"} size="compact" /></td><td><span className={`payout-badge payout-badge--${statusClass(entry)}`}>{!isPayable(entry) ? <CircleMinus size={13} /> : entry.status === "PAID" ? <BadgeCheck size={13} /> : entry.status === "WAIVED" ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}{displayStatus(entry)}</span></td><td><LedgerTimeline entry={entry} /></td><td><PayoutRecorder value={entry.processedBy} /></td><td className="payout-ledger-open"><Link href={`/chains/${entry.chainId}`} aria-label={`Open chain ${entry.chainId}`} title={`Open chain #${entry.chainId}`}><ChevronRight size={15} /></Link></td></tr>)}</tbody></table>{visible.length === 0 && <div className="table-empty payout-ledger-empty"><CircleDollarSign size={22} /><div><strong>{entries.length ? "No records match this control view" : "No payout records yet"}</strong><span>{entries.length ? "Reset the filters or search a different member, chain, or recorder." : message}</span></div></div>}</div>
      <div className="payout-register-footer"><span>Showing {visible.length ? safePage * pageSize + 1 : 0}–{Math.min((safePage + 1) * pageSize, filtered.length)} of {filtered.length.toLocaleString()} <small>· {formatTotals(filteredTotals)} in this view</small></span><div className="pagination"><button disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft size={14} /> Previous</button><span>Page {safePage + 1} of {pageCount}</span><button disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next <ChevronRight size={14} /></button></div></div>
    </section>}
  </>;
}

function LifecycleItem({ tone, label, count }: { tone: string; label: string; count: number }) {
  return <span><i className={`payout-lifecycle__dot payout-lifecycle__dot--${tone}`} /><strong>{label}</strong><small>{count.toLocaleString()}</small></span>;
}

function PostureRow({ tone, title, detail }: { tone: "clear" | "danger" | "warning" | "neutral"; title: string; detail: string }) {
  return <li className={`payout-posture__row payout-posture__row--${tone}`}><span>{tone === "clear" ? <ShieldCheck size={15} /> : tone === "danger" ? <ShieldAlert size={15} /> : tone === "warning" ? <AlertTriangle size={15} /> : <CircleGauge size={15} />}</span><div><strong>{title}</strong><small>{detail}</small></div></li>;
}

function SortableLedgerHeader({ label, value, active, direction, onSort, numeric = false }: { label: string; value: LedgerSort; active: LedgerSort; direction: SortDirection; onSort: (value: LedgerSort) => void; numeric?: boolean }) {
  const selected = active === value;
  const Icon = selected && direction === "asc" ? ArrowUp : ArrowDown;
  return <th className={numeric ? "numeric" : undefined} aria-sort={selected ? direction === "asc" ? "ascending" : "descending" : undefined}><button className="payout-sort-button" onClick={() => onSort(value)}>{label}<Icon size={12} className={selected ? "payout-sort-button__active" : undefined} /></button></th>;
}

function LedgerTimeline({ entry }: { entry: PayoutLedgerEntry }) {
  if (!isPayable(entry)) {
    const assessedAt = entry.processedAt ?? entry.createdAt;
    return <span className="ledger-date ledger-date--ineligible"><strong>{new Date(assessedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong><small>Assessed · no payment due</small></span>;
  }
  if (entry.processedAt) return <span className="ledger-date"><strong>{new Date(entry.processedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong><small>{new Date(entry.processedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · processed</small></span>;
  return <span className="ledger-date ledger-date--open"><strong>{new Date(entry.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong><small>Created · not processed</small></span>;
}

function PayoutRecorder({ value }: { value: PayoutLedgerEntry["processedBy"] }) {
  if (!value) return <span className="muted-value">System / legacy</span>;
  return <TornUserLink className="ledger-processor" name={value.name} tornUserId={value.tornUserId} avatar={false} detail="Payment recorder" />;
}

function matchesView(entry: PayoutLedgerEntry, view: LedgerView): boolean {
  if (view === "ALL") return true;
  if (view === "NOT_ELIGIBLE") return !isPayable(entry);
  if (!isPayable(entry)) return false;
  if (view === "ACTION") return entry.status === "PENDING" || entry.status === "APPROVED" || entry.status === "HELD";
  return entry.status === view;
}

function compareEntries(left: PayoutLedgerEntry, right: PayoutLedgerEntry, sort: LedgerSort, direction: SortDirection): number {
  const multiplier = direction === "asc" ? 1 : -1;
  let comparison = 0;
  if (sort === "CHAIN") comparison = left.chainId - right.chainId;
  else if (sort === "MEMBER") comparison = left.memberName.localeCompare(right.memberName);
  else if (sort === "AMOUNT") comparison = left.amount - right.amount;
  else comparison = (left.processedAt ?? left.createdAt).localeCompare(right.processedAt ?? right.createdAt);
  return comparison * multiplier || left.memberName.localeCompare(right.memberName);
}

function viewCount(view: LedgerView, analysis: PayoutLedgerAnalysis, total: number): number {
  if (view === "ALL") return total;
  if (view === "ACTION") return analysis.pending + analysis.approved + analysis.held;
  if (view === "NOT_ELIGIBLE") return analysis.notEligible;
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
function totalsForEntries(entries: readonly PayoutLedgerEntry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) addTotal(totals, entry.rewardUnit, entry.amount);
  return totals;
}
function singleTotal(totals: ReadonlyMap<string, number>): readonly [string, number] | null {
  const values = [...totals.entries()].filter(([, amount]) => amount !== 0);
  return values.length === 1 ? values[0] ?? null : null;
}
function isPayable(entry: PayoutLedgerEntry): boolean { return entry.amount > 0; }
function statusClass(entry: PayoutLedgerEntry): string { return isPayable(entry) ? entry.status.toLowerCase() : "not-eligible"; }
function displayStatus(entry: PayoutLedgerEntry): string { return isPayable(entry) ? entry.status.charAt(0) + entry.status.slice(1).toLowerCase() : "Not eligible"; }
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
  return `${analysis.resolved.toLocaleString()} of ${analysis.payable.toLocaleString()} payable records are paid or waived${analysis.notEligible ? `; ${analysis.notEligible.toLocaleString()} below-threshold or zero-reward decision${analysis.notEligible === 1 ? " is" : "s are"} excluded` : ""}. The register preserves every reward decision for dispute review.`;
}
