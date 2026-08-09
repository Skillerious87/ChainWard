"use client";

import { BadgeCheck, Check, CircleDollarSign, Search, ShieldAlert, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TornUserLink } from "@/components/ui/torn-user-link";
import type { PayoutLedgerEntry } from "@/lib/rewards/payout-store";

type LedgerView = "All" | "Paid" | "Needs action";

export function PayoutLedger({ entries, message }: { entries: PayoutLedgerEntry[]; message: string }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<LedgerView>("All");
  const [filterOpen, setFilterOpen] = useState(false);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return entries.filter((entry) => (view === "All" || (view === "Paid" ? entry.status === "PAID" : entry.status !== "PAID")) && (!normalized || `${entry.memberName} ${entry.tornUserId} ${entry.chainId} ${entry.tierLabel ?? ""}`.toLowerCase().includes(normalized)));
  }, [entries, query, view]);

  return <section className="data-section professional-payout-ledger">
    <div className="section-heading section-heading--table"><div><h2>Member payout register</h2><p>{visible.length} persisted record{visible.length === 1 ? "" : "s"} match this view</p></div><div className="table-tools"><label className="search-field"><Search size={15} /><span className="sr-only">Search payout records</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Member, ID, chain, or tier" /></label><div className="menu-control"><button className={`button button--quiet${view !== "All" ? " button--active" : ""}`} onClick={() => setFilterOpen((value) => !value)} aria-expanded={filterOpen}><SlidersHorizontal size={15} /> {view}</button>{filterOpen && <><button className="menu-control__scrim" aria-label="Close payout filter" onClick={() => setFilterOpen(false)} /><div className="menu-popover menu-popover--right">{(["All", "Paid", "Needs action"] as const).map((option) => <button key={option} onClick={() => { setView(option); setFilterOpen(false); }}><span><strong>{option}</strong><small>{option === "All" ? "Every persisted entry" : option === "Paid" ? "Completed acknowledgements" : "Pending, approved, or held"}</small></span>{view === option && <Check size={13} />}</button>)}</div></>}</div></div></div>
    <div className="table-scroll"><table className="data-table payout-ledger-table"><thead><tr><th>Member</th><th>Chain</th><th>Reward tier</th><th className="numeric">Reward</th><th>Status</th><th>Processed</th><th>Recorded by</th></tr></thead><tbody>{visible.map((entry) => <tr key={entry.id}><td><TornUserLink className="ledger-member" name={entry.memberName} tornUserId={entry.tornUserId} detail="Payout recipient" /></td><td><Link className="chain-id" href={`/chains/${entry.chainId}`}>#{entry.chainId}</Link></td><td>{entry.tierLabel ? <span className="tier-label">{entry.tierLabel}</span> : <span className="muted-value">No tier</span>}</td><td className="numeric"><span className="ledger-amount"><strong>{entry.amount.toLocaleString()}</strong><small>{entry.rewardUnit}</small></span></td><td><span className={`payout-badge payout-badge--${statusClass(entry.status)}`}>{entry.status === "PAID" ? <BadgeCheck size={13} /> : <ShieldAlert size={12} />}{statusLabel(entry.status)}</span></td><td>{entry.processedAt ? <span className="ledger-date"><strong>{new Date(entry.processedAt).toLocaleDateString("en-GB")}</strong><small>{new Date(entry.processedAt).toLocaleTimeString("en-GB")}</small></span> : <span className="muted-value">Not processed</span>}</td><td><PayoutRecorder value={entry.processedBy} /></td></tr>)}</tbody></table>{visible.length === 0 && <div className="table-empty"><CircleDollarSign size={21} /> {entries.length ? "No payout records match these filters." : message}</div>}</div>
    <div className="table-footer"><span>Payment state is created only by a deliberate Chainward action</span><span>{message}</span></div>
  </section>;
}

function statusClass(status: PayoutLedgerEntry["status"]): string { return status === "PAID" ? "paid" : status === "APPROVED" ? "approved" : status === "HELD" ? "held" : "pending"; }
function statusLabel(status: PayoutLedgerEntry["status"]): string { return status.charAt(0) + status.slice(1).toLowerCase(); }
function PayoutRecorder({ value }: { value: PayoutLedgerEntry["processedBy"] | unknown }) {
  if (!value || typeof value !== "object") return <span className="muted-value">System</span>;
  const identity = value as Record<string, unknown>;
  if (typeof identity.name !== "string" || typeof identity.tornUserId !== "number") return <span className="muted-value">Unknown recorder</span>;
  return <TornUserLink className="ledger-processor" name={identity.name} tornUserId={identity.tornUserId} avatar={false} detail="Payment recorder" />;
}
