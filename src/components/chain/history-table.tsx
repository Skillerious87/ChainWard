"use client";

import { BadgeCheck, CalendarRange, Check, CircleDollarSign, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { RewardAmount } from "@/components/ui/reward-amount";
import type { ChainSettlementSummary } from "@/lib/rewards/chain-settlement";
import type { TornChainHistoryItem } from "@/lib/torn/workspace-types";

const pageSize = 8;

type SettlementView = "all" | "open" | "calculated" | "paid";
const settlementViews: { id: SettlementView; label: string; hint: string }[] = [
  { id: "all", label: "All chains", hint: "Every returned record" },
  { id: "open", label: "Needs calculation", hint: "No reward snapshot yet" },
  { id: "calculated", label: "Awaiting payment", hint: "Calculated but not marked paid" },
  { id: "paid", label: "Paid", hint: "Acknowledged settlements" },
];

export function HistoryTable({ chains, message, checkedAt, settlements }: { chains: TornChainHistoryItem[]; message: string; checkedAt: string; settlements: Record<number, ChainSettlementSummary> }) {
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<"all" | "30" | "90">("all");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [settlementView, setSettlementView] = useState<SettlementView>("all");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const cutoff = period === "all" ? 0 : Math.floor(Date.parse(checkedAt) / 1_000) - Number(period) * 86_400;
    return chains.filter((chain) => {
      const settlement = settlements[chain.id];
      const state: SettlementView = settlement?.status === "PAID" ? "paid" : settlement ? "calculated" : "open";
      const matchesSettlement = settlementView === "all" || settlementView === state;
      return chain.endedAt >= cutoff && matchesSettlement && (!normalized || String(chain.id).includes(normalized) || String(chain.hits).includes(normalized));
    });
  }, [chains, checkedAt, period, query, settlementView, settlements]);

  const counts = useMemo(() => {
    const tally: Record<SettlementView, number> = { all: chains.length, open: 0, calculated: 0, paid: 0 };
    for (const chain of chains) {
      const settlement = settlements[chain.id];
      tally[settlement?.status === "PAID" ? "paid" : settlement ? "calculated" : "open"] += 1;
    }
    return tally;
  }, [chains, settlements]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  return <section className="data-section">
    <div className="section-heading section-heading--table"><div><h2>Completed chains</h2><p>{filtered.length} Torn chain records match this view</p></div><div className="table-tools"><label className="search-field"><Search size={15} /><span className="sr-only">Search chains</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Chain ID or hits" /></label><div className="menu-control"><button className="button button--quiet" onClick={() => setPeriodOpen((value) => !value)}><CalendarRange size={15} />{period === "all" ? "All returned" : `Last ${period} days`}</button>{periodOpen && <><button className="menu-control__scrim" aria-label="Close date menu" onClick={() => setPeriodOpen(false)} /><div className="menu-popover menu-popover--right">{(["30", "90", "all"] as const).map((value) => <button key={value} onClick={() => { setPeriod(value); setPage(0); setPeriodOpen(false); }}><span><strong>{value === "all" ? "All returned chains" : `Last ${value} days`}</strong></span>{period === value && <Check size={14} />}</button>)}</div></>}</div></div></div>
    <div className="history-view-tabs" role="tablist" aria-label="Settlement state">{settlementViews.map((option) => <button key={option.id} role="tab" aria-selected={settlementView === option.id} className={settlementView === option.id ? "history-view-tab--active" : undefined} title={option.hint} onClick={() => { setSettlementView(option.id); setPage(0); }}>{option.label}<span>{counts[option.id]}</span></button>)}</div>
    <div className="table-scroll"><table className="data-table history-table"><thead><tr><th>Chain</th><th>Completed</th><th className="numeric">Final hits</th><th>Duration</th><th className="numeric">Respect</th><th className="numeric reward-column">Rewards</th><th>Payout</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{visible.map((chain) => {
      const settlement = settlements[chain.id];
      return <tr key={chain.id}><td><Link className="chain-id" href={`/chains/${chain.id}`}>#{chain.id}</Link></td><td><strong>{formatDate(chain.endedAt)}</strong><small className="history-time">{formatTime(chain.startedAt)} → {formatTime(chain.endedAt)}</small></td><td className="numeric"><strong>{chain.hits.toLocaleString()}</strong></td><td>{formatDuration(chain.endedAt - chain.startedAt)}</td><td className="numeric"><strong>{chain.respect.toFixed(2)}</strong></td><td className="numeric reward-column">{settlement ? <RewardAmount amount={settlement.totalAmount} unit={settlement.rewardUnit} detail={`${settlement.memberCount} members`} paid={settlement.status === "PAID"} size="compact" artwork="liability" /> : <Link href={`/chains/${chain.id}`} className="history-reward-empty"><CircleDollarSign size={13} /> Calculate</Link>}</td><td>{settlement?.status === "PAID" ? <span className="history-paid"><BadgeCheck size={14} /> PAID</span> : <span className="history-unpaid">Not marked</span>}</td><td><Link className="row-action" href={`/chains/${chain.id}`} aria-label={`Open chain ${chain.id}`}>→</Link></td></tr>;
    })}</tbody></table>{visible.length === 0 && <div className="table-empty">{query ? "No completed chains match these filters." : message}</div>}</div>
    <div className="table-footer"><span>Page {safePage + 1} of {pageCount} · {filtered.length} API records</span><div className="pagination"><button disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><button disabled={safePage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>Next</button></div></div>
  </section>;
}

function formatDate(timestamp: number): string { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(timestamp * 1_000); }
function formatTime(timestamp: number): string { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(timestamp * 1_000); }
function formatDuration(seconds: number): string { const hours = Math.floor(seconds / 3_600); const minutes = Math.floor((seconds % 3_600) / 60); return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`; }
