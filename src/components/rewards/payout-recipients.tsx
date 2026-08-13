"use client";

import { Coins, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { TornUserName } from "@/components/ui/torn-user-link";
import type { PayoutLedgerEntry } from "@/lib/rewards/payout-store";

interface RecipientTotal {
  tornUserId: number;
  memberName: string;
  paid: number;
  outstanding: number;
  unit: string;
  chains: Set<number>;
}

/**
 * Member-level totals, partitioned by reward unit.
 *
 * A member may receive both items and currency. Ranking or summing those values
 * together would be mathematically meaningless, so every unit gets its own
 * leaderboard and scale.
 */
export function PayoutRecipients({ entries }: { entries: PayoutLedgerEntry[] }) {
  const [showAll, setShowAll] = useState(false);

  const groups = useMemo(() => {
    const byRecipientUnit = new Map<string, RecipientTotal>();
    for (const entry of entries) {
      const key = `${entry.tornUserId}:${entry.rewardUnit}`;
      const existing = byRecipientUnit.get(key) ?? { tornUserId: entry.tornUserId, memberName: entry.memberName, paid: 0, outstanding: 0, unit: entry.rewardUnit, chains: new Set<number>() };
      if (entry.status === "PAID") existing.paid += entry.amount;
      else if (entry.status !== "WAIVED") existing.outstanding += entry.amount;
      existing.chains.add(entry.chainId);
      existing.memberName = entry.memberName;
      byRecipientUnit.set(key, existing);
    }
    const byUnit = new Map<string, RecipientTotal[]>();
    for (const recipient of byRecipientUnit.values()) {
      const unit = byUnit.get(recipient.unit) ?? [];
      unit.push(recipient);
      byUnit.set(recipient.unit, unit);
    }
    return [...byUnit.entries()].map(([unit, recipients]) => ({
      unit,
      recipients: recipients.toSorted((left, right) => (right.paid + right.outstanding) - (left.paid + left.outstanding) || left.memberName.localeCompare(right.memberName)),
      peak: Math.max(1, ...recipients.map((recipient) => recipient.paid + recipient.outstanding)),
    })).toSorted((left, right) => left.unit.localeCompare(right.unit));
  }, [entries]);

  if (groups.length === 0) return null;

  const distinctMembers = new Set(entries.map((entry) => entry.tornUserId)).size;
  const rowLimit = groups.length > 1 ? 5 : 8;
  const hiddenCount = groups.reduce((total, group) => total + Math.max(0, group.recipients.length - rowLimit), 0);

  return (
    <section className="panel payout-recipients">
      <div className="section-heading">
        <div>
          <h2>Recipient analysis</h2>
          <p>{distinctMembers} member{distinctMembers === 1 ? "" : "s"} · ranked separately inside each reward unit</p>
        </div>
        <span className="payout-recipients__unit"><Coins size={13} /> {groups.length === 1 ? groups[0]?.unit : `${groups.length} reward units`}</span>
      </div>

      <div className="payout-recipient-groups">
        {groups.map((group) => {
          const visible = showAll ? group.recipients : group.recipients.slice(0, rowLimit);
          return <section className="payout-recipient-group" key={group.unit}>
            {groups.length > 1 && <header><span>{group.unit}</span><small>{group.recipients.length} recipient{group.recipients.length === 1 ? "" : "s"}</small></header>}
            <ol className="payout-recipients__list">
              {visible.map((recipient, index) => {
                const total = recipient.paid + recipient.outstanding;
                return <li key={`${recipient.tornUserId}:${recipient.unit}`} className={index === 0 ? "payout-recipient payout-recipient--lead" : "payout-recipient"}>
                  <span className="payout-recipient__rank">{index === 0 ? <Trophy size={13} /> : index + 1}</span>
                  <div className="payout-recipient__identity"><TornUserName name={recipient.memberName} tornUserId={recipient.tornUserId} /><small>{recipient.chains.size} chain{recipient.chains.size === 1 ? "" : "s"} · {recipient.unit}</small></div>
                  <div className="payout-recipient__bar" aria-hidden="true"><i className="payout-recipient__bar-paid" style={{ width: `${(recipient.paid / group.peak) * 100}%` }} /><i className="payout-recipient__bar-open" style={{ width: `${(recipient.outstanding / group.peak) * 100}%` }} /></div>
                  <div className="payout-recipient__totals"><strong>{total.toLocaleString("en-GB", { maximumFractionDigits: 4 })}</strong><small>{recipient.paid.toLocaleString("en-GB", { maximumFractionDigits: 4 })} paid{recipient.outstanding > 0 && <em> · {recipient.outstanding.toLocaleString("en-GB", { maximumFractionDigits: 4 })} open</em>}</small></div>
                </li>;
              })}
            </ol>
          </section>;
        })}
      </div>

      {hiddenCount > 0 && <button className="payout-recipients__toggle" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show concise recipient view" : `Show ${hiddenCount} more recipient record${hiddenCount === 1 ? "" : "s"}`}</button>}
    </section>
  );
}
