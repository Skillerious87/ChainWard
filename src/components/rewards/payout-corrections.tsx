"use client";

import { CalendarClock, ChevronRight, FileClock, Search, Undo2, UserRoundCheck } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { ExportButton } from "@/components/ui/action-controls";
import type { PayoutRevertRecord } from "@/lib/rewards/chain-settlement";

/** Withdrawn payout acknowledgements with the evidence needed for review. */
export function PayoutCorrections({ corrections }: { corrections: PayoutRevertRecord[] }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    if (!normalized) return corrections;
    return corrections.filter((correction) => `${correction.chainId} ${correction.reason} ${correction.revertedByName} ${correction.rewardUnit ?? ""}`.toLowerCase().includes(normalized));
  }, [corrections, deferredQuery]);
  const chainCount = new Set(corrections.map((correction) => correction.chainId)).size;
  const operatorCount = new Set(corrections.map((correction) => correction.revertedByName)).size;
  const totals = totalsByUnit(corrections);
  const latest = corrections[0]?.revertedAt ?? null;
  const exportRows = filtered.map((correction) => ({
    chainId: correction.chainId,
    reason: correction.reason,
    amount: correction.totalAmount ?? "",
    rewardUnit: correction.rewardUnit ?? "",
    revertedAt: correction.revertedAt,
    revertedBy: correction.revertedByName,
  }));

  return (
    <section id="payout-corrections" className="payout-support-section payout-corrections payout-workspace-section payout-correction-view">
      <header className="payout-view-heading">
        <div><p className="eyebrow">Exception audit</p><h2>Withdrawn acknowledgements</h2><p>Every reversal remains attributable to a chain, operator, time, and stated reason. This is the review trail for payouts returned to unpaid.</p></div>
        <span className="payout-corrections__badge"><Undo2 size={13} /> Corrections</span>
      </header>

      <div className="payout-correction-summary" aria-label="Correction summary">
        <article><span><Undo2 size={17} /></span><div><small>Withdrawals</small><strong>{corrections.length.toLocaleString()}</strong><em>Acknowledgements reversed</em></div></article>
        <article><span><FileClock size={17} /></span><div><small>Affected chains</small><strong>{chainCount.toLocaleString()}</strong><em>Returned to unpaid</em></div></article>
        <article><span><UserRoundCheck size={17} /></span><div><small>Operators</small><strong>{operatorCount.toLocaleString()}</strong><em>Named correction authors</em></div></article>
        <article><span><CalendarClock size={17} /></span><div><small>Latest correction</small><strong>{latest ? formatDate(latest) : "None"}</strong><em>{formatTotals(totals)}</em></div></article>
      </div>

      <div className="payout-correction-toolbar">
        <label className="search-field"><Search size={15} /><span className="sr-only">Search payout corrections</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Chain, reason, operator, or unit" /></label>
        <span>{filtered.length.toLocaleString()} of {corrections.length.toLocaleString()} corrections</span>
        <ExportButton filename="chainward-payout-corrections.csv" label={`Export corrections (${filtered.length})`} rows={exportRows} className="button button--quiet" />
      </div>

      <ol className="payout-corrections__list">
        {filtered.map((correction) => (
          <li key={correction.id}>
            <span className="payout-corrections__timeline" aria-hidden="true"><Undo2 size={14} /></span>
            <div className="payout-corrections__content">
              <div className="payout-corrections__head">
                <Link className="chain-id" href={`/chains/${correction.chainId}`}>Chain #{correction.chainId}</Link>
                {correction.totalAmount !== null && <span className="payout-corrections__amount">{correction.totalAmount.toLocaleString("en-GB", { maximumFractionDigits: 4 })} {correction.rewardUnit ?? "units"}</span>}
                <time dateTime={correction.revertedAt}>{formatDateTime(correction.revertedAt)}</time>
              </div>
              <p className="payout-corrections__reason">{correction.reason}</p>
              <div className="payout-corrections__meta"><span><UserRoundCheck size={12} /> Withdrawn by <strong>{correction.revertedByName}</strong></span><Link href={`/chains/${correction.chainId}`}>Review chain <ChevronRight size={13} /></Link></div>
            </div>
          </li>
        ))}
        {filtered.length === 0 && <li className="payout-support-empty"><Undo2 size={19} /><div><strong>{corrections.length ? "No corrections match this search" : "No withdrawn acknowledgements"}</strong><small>{corrections.length ? "Try another chain, reason, operator, or reward unit." : "Any payout returned to unpaid will retain its reason and operator here."}</small></div></li>}
      </ol>
    </section>
  );
}

function totalsByUnit(corrections: readonly PayoutRevertRecord[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const correction of corrections) {
    if (correction.totalAmount === null) continue;
    const unit = correction.rewardUnit ?? "units";
    totals.set(unit, (totals.get(unit) ?? 0) + correction.totalAmount);
  }
  return totals;
}

function formatTotals(totals: ReadonlyMap<string, number>): string {
  if (!totals.size) return "No recorded value";
  if (totals.size > 2) return `${totals.size} reward units affected`;
  return [...totals].map(([unit, amount]) => `${amount.toLocaleString("en-GB", { maximumFractionDigits: 4 })} ${unit}`).join(" · ");
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
