"use client";

import { BadgeCheck, Clock3, Coins, Layers3, Search, Trophy, Users } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { ExportButton } from "@/components/ui/action-controls";
import { TornUserName } from "@/components/ui/torn-user-link";
import type { PayoutLedgerEntry } from "@/lib/rewards/payout-store";

type RecipientSort = "TOTAL" | "OUTSTANDING" | "PAID" | "NAME";

interface RecipientTotal {
  tornUserId: number;
  memberName: string;
  paid: number;
  outstanding: number;
  waived: number;
  unit: string;
  chains: Set<number>;
}

/** Member totals stay partitioned by reward unit: items and currency are never combined. */
export function PayoutRecipients({ entries }: { entries: PayoutLedgerEntry[] }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [unit, setUnit] = useState("ALL");
  const [sort, setSort] = useState<RecipientSort>("TOTAL");
  const [showAll, setShowAll] = useState(false);
  const recipients = useMemo(() => aggregateRecipients(entries), [entries]);
  const units = useMemo(() => [...new Set(recipients.map((recipient) => recipient.unit))].toSorted(), [recipients]);
  const filteredRecipients = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    return recipients.filter((recipient) => (unit === "ALL" || recipient.unit === unit)
      && (!normalized || `${recipient.memberName} ${recipient.tornUserId} ${[...recipient.chains].join(" ")}`.toLowerCase().includes(normalized)));
  }, [deferredQuery, recipients, unit]);
  const groups = useMemo(() => groupRecipients(filteredRecipients, sort), [filteredRecipients, sort]);
  const distinctMembers = new Set(entries.map((entry) => entry.tornUserId)).size;
  const paidMembers = new Set(entries.filter((entry) => entry.status === "PAID").map((entry) => entry.tornUserId)).size;
  const openMembers = new Set(entries.filter((entry) => !["PAID", "WAIVED"].includes(entry.status)).map((entry) => entry.tornUserId)).size;
  const chainCount = new Set(entries.map((entry) => entry.chainId)).size;
  const rowLimit = groups.length > 1 ? 6 : 10;
  const hiddenCount = groups.reduce((total, group) => total + Math.max(0, group.recipients.length - rowLimit), 0);
  const exportRows = filteredRecipients.map((recipient) => ({
    tornUserId: recipient.tornUserId,
    member: recipient.memberName,
    rewardUnit: recipient.unit,
    paid: recipient.paid,
    outstanding: recipient.outstanding,
    waived: recipient.waived,
    chains: [...recipient.chains].toSorted((left, right) => right - left).join(" | "),
  }));

  return (
    <section id="payout-recipients" className="payout-support-section payout-recipients payout-workspace-section payout-recipient-view">
      <header className="payout-view-heading">
        <div><p className="eyebrow">Member exposure</p><h2>Recipient analysis</h2><p>Compare paid and outstanding rewards by member. Values stay partitioned by reward unit so currency and items are never combined.</p></div>
        <span className="payout-recipients__unit"><Coins size={13} /> {units.length === 1 ? units[0] : `${units.length} reward units`}</span>
      </header>

      <div className="payout-recipient-summary" aria-label="Recipient summary">
        <article><span><Users size={17} /></span><div><small>Recipients</small><strong>{distinctMembers.toLocaleString()}</strong><em>Distinct Torn members</em></div></article>
        <article><span><BadgeCheck size={17} /></span><div><small>Paid members</small><strong>{paidMembers.toLocaleString()}</strong><em>With an acknowledged reward</em></div></article>
        <article className={openMembers ? "payout-recipient-summary__attention" : undefined}><span><Clock3 size={17} /></span><div><small>Open exposure</small><strong>{openMembers.toLocaleString()}</strong><em>{openMembers ? "Members awaiting resolution" : "No recipient liability"}</em></div></article>
        <article><span><Layers3 size={17} /></span><div><small>Chain coverage</small><strong>{chainCount.toLocaleString()}</strong><em>Persisted settlements</em></div></article>
      </div>

      <div className="payout-recipient-toolbar">
        <label className="search-field"><Search size={15} /><span className="sr-only">Search recipients</span><input value={query} onChange={(event) => { setQuery(event.target.value); setShowAll(false); }} placeholder="Member, Torn ID, or chain" /></label>
        <label><span>Reward unit</span><select value={unit} onChange={(event) => { setUnit(event.target.value); setShowAll(false); }}><option value="ALL">All units</option>{units.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        <label><span>Rank by</span><select value={sort} onChange={(event) => setSort(event.target.value as RecipientSort)}><option value="TOTAL">Total allocation</option><option value="OUTSTANDING">Outstanding first</option><option value="PAID">Paid first</option><option value="NAME">Member name</option></select></label>
        <ExportButton filename="chainward-payout-recipients.csv" label={`Export recipients (${filteredRecipients.length})`} rows={exportRows} className="button button--quiet" />
      </div>

      <div className="payout-recipient-groups">
        {groups.map((group) => {
          const visible = showAll ? group.recipients : group.recipients.slice(0, rowLimit);
          return <section className="payout-recipient-group" key={group.unit}>
            <header><span>{group.unit}</span><small>{group.recipients.length} recipient{group.recipients.length === 1 ? "" : "s"} · totals use this unit only</small></header>
            <ol className="payout-recipients__list">
              {visible.map((recipient, index) => {
                const total = recipient.paid + recipient.outstanding;
                return <li key={`${recipient.tornUserId}:${recipient.unit}`} className={index === 0 && sort !== "NAME" ? "payout-recipient payout-recipient--lead" : "payout-recipient"}>
                  <span className="payout-recipient__rank">{index === 0 && sort !== "NAME" ? <Trophy size={13} /> : index + 1}</span>
                  <div className="payout-recipient__identity"><TornUserName name={recipient.memberName} tornUserId={recipient.tornUserId} /><small>{recipient.chains.size} chain{recipient.chains.size === 1 ? "" : "s"} · Torn #{recipient.tornUserId}</small></div>
                  <div className="payout-recipient__bar" aria-label={`${formatAmount(recipient.paid)} ${recipient.unit} paid and ${formatAmount(recipient.outstanding)} outstanding`}><i className="payout-recipient__bar-paid" style={{ width: `${(recipient.paid / group.peak) * 100}%` }} /><i className="payout-recipient__bar-open" style={{ width: `${(recipient.outstanding / group.peak) * 100}%` }} /></div>
                  <div className="payout-recipient__totals"><strong>{formatAmount(total)} <b>{recipient.unit}</b></strong><small>{formatAmount(recipient.paid)} paid{recipient.outstanding > 0 && <em> · {formatAmount(recipient.outstanding)} open</em>}</small></div>
                </li>;
              })}
            </ol>
          </section>;
        })}
        {groups.length === 0 && <div className="payout-support-empty"><Coins size={19} /><div><strong>{entries.length ? "No recipients match this view" : "No recipient totals yet"}</strong><small>{entries.length ? "Try a different member, Torn ID, chain, or reward unit." : "Settled and outstanding member rewards will be ranked here."}</small></div></div>}
      </div>

      {hiddenCount > 0 && <button className="payout-recipients__toggle" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show concise recipient view" : `Show ${hiddenCount} more recipient record${hiddenCount === 1 ? "" : "s"}`}</button>}
    </section>
  );
}

function aggregateRecipients(entries: readonly PayoutLedgerEntry[]): RecipientTotal[] {
  const recipients = new Map<string, RecipientTotal>();
  for (const entry of entries) {
    const key = `${entry.tornUserId}:${entry.rewardUnit}`;
    const current = recipients.get(key) ?? { tornUserId: entry.tornUserId, memberName: entry.memberName, paid: 0, outstanding: 0, waived: 0, unit: entry.rewardUnit, chains: new Set<number>() };
    if (entry.status === "PAID") current.paid += entry.amount;
    else if (entry.status === "WAIVED") current.waived += entry.amount;
    else current.outstanding += entry.amount;
    current.chains.add(entry.chainId);
    current.memberName = entry.memberName;
    recipients.set(key, current);
  }
  return [...recipients.values()];
}

function groupRecipients(recipients: readonly RecipientTotal[], sort: RecipientSort) {
  const byUnit = new Map<string, RecipientTotal[]>();
  for (const recipient of recipients) byUnit.set(recipient.unit, [...(byUnit.get(recipient.unit) ?? []), recipient]);
  return [...byUnit.entries()].map(([unit, values]) => ({ unit, recipients: values.toSorted((left, right) => compareRecipients(left, right, sort)), peak: Math.max(1, ...values.map((recipient) => recipient.paid + recipient.outstanding)) })).toSorted((left, right) => left.unit.localeCompare(right.unit));
}

function compareRecipients(left: RecipientTotal, right: RecipientTotal, sort: RecipientSort): number {
  if (sort === "NAME") return left.memberName.localeCompare(right.memberName);
  if (sort === "PAID") return right.paid - left.paid || right.outstanding - left.outstanding || left.memberName.localeCompare(right.memberName);
  if (sort === "OUTSTANDING") return right.outstanding - left.outstanding || right.paid - left.paid || left.memberName.localeCompare(right.memberName);
  return (right.paid + right.outstanding) - (left.paid + left.outstanding) || left.memberName.localeCompare(right.memberName);
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("en-GB", { maximumFractionDigits: 4 });
}
