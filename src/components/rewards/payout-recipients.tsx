"use client";

import { Coins, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { TornUserName } from "@/components/ui/torn-user-link";
import type { PayoutLedgerEntry } from "@/lib/rewards/payout-store";

/**
 * Who has actually been paid, and how much.
 *
 * The register answers "what happened to this chain"; this answers "what does
 * this member have owed or received across every chain", which is the question
 * asked when someone disputes a payout. Totals are grouped per reward unit,
 * because summing Xanax with anything else would be meaningless.
 */
export function PayoutRecipients({ entries }: { entries: PayoutLedgerEntry[] }) {
  const [showAll, setShowAll] = useState(false);

  const recipients = useMemo(() => {
    const byMember = new Map<number, { tornUserId: number; memberName: string; paid: number; outstanding: number; unit: string; chains: Set<number> }>();
    for (const entry of entries) {
      const existing = byMember.get(entry.tornUserId) ?? { tornUserId: entry.tornUserId, memberName: entry.memberName, paid: 0, outstanding: 0, unit: entry.rewardUnit, chains: new Set<number>() };
      if (entry.status === "PAID") existing.paid += entry.amount;
      else existing.outstanding += entry.amount;
      existing.chains.add(entry.chainId);
      existing.memberName = entry.memberName;
      byMember.set(entry.tornUserId, existing);
    }
    return [...byMember.values()].sort((left, right) => (right.paid + right.outstanding) - (left.paid + left.outstanding) || left.memberName.localeCompare(right.memberName));
  }, [entries]);

  if (recipients.length === 0) return null;

  const units = new Set(entries.map((entry) => entry.rewardUnit));
  const mixedUnits = units.size > 1;
  const visible = showAll ? recipients : recipients.slice(0, 8);
  const peak = Math.max(1, ...recipients.map((recipient) => recipient.paid + recipient.outstanding));

  return (
    <section className="panel payout-recipients">
      <div className="section-heading">
        <div>
          <h2>Recipients</h2>
          <p>{recipients.length} member{recipients.length === 1 ? "" : "s"} across every stored snapshot</p>
        </div>
        <span className="payout-recipients__unit"><Coins size={13} /> {mixedUnits ? "Mixed units" : [...units][0] ?? "units"}</span>
      </div>

      <ol className="payout-recipients__list">
        {visible.map((recipient, index) => {
          const total = recipient.paid + recipient.outstanding;
          return (
            <li key={recipient.tornUserId} className={index === 0 ? "payout-recipient payout-recipient--lead" : "payout-recipient"}>
              <span className="payout-recipient__rank">{index === 0 ? <Trophy size={13} /> : index + 1}</span>
              <div className="payout-recipient__identity">
                <TornUserName name={recipient.memberName} tornUserId={recipient.tornUserId} />
                <small>{recipient.chains.size} chain{recipient.chains.size === 1 ? "" : "s"}</small>
              </div>
              <div className="payout-recipient__bar" aria-hidden="true">
                <i className="payout-recipient__bar-paid" style={{ width: `${(recipient.paid / peak) * 100}%` }} />
                <i className="payout-recipient__bar-open" style={{ width: `${(recipient.outstanding / peak) * 100}%` }} />
              </div>
              <div className="payout-recipient__totals">
                <strong>{total.toLocaleString()}</strong>
                <small>
                  {recipient.paid.toLocaleString()} paid
                  {recipient.outstanding > 0 && <em> · {recipient.outstanding.toLocaleString()} open</em>}
                </small>
              </div>
            </li>
          );
        })}
      </ol>

      {recipients.length > 8 && (
        <button className="payout-recipients__toggle" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show top 8 only" : `Show all ${recipients.length} recipients`}
        </button>
      )}
    </section>
  );
}
