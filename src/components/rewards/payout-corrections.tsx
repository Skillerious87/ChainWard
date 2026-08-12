import { Undo2 } from "lucide-react";
import Link from "next/link";
import type { PayoutRevertRecord } from "@/lib/rewards/chain-settlement";

/**
 * Withdrawn payout acknowledgements.
 *
 * A settlement that is reverted leaves the register entirely, so without this
 * the ledger would quietly forget that a chain had ever been marked paid. Every
 * correction is shown with the reason its author gave.
 */
export function PayoutCorrections({ corrections }: { corrections: PayoutRevertRecord[] }) {
  if (corrections.length === 0) return null;

  return (
    <section className="panel payout-corrections">
      <div className="section-heading">
        <div>
          <h2>Withdrawn acknowledgements</h2>
          <p>{corrections.length} payout{corrections.length === 1 ? "" : "s"} returned to unpaid</p>
        </div>
        <span className="payout-corrections__badge"><Undo2 size={13} /> Corrections</span>
      </div>

      <ol className="payout-corrections__list">
        {corrections.map((correction) => (
          <li key={correction.id}>
            <div className="payout-corrections__head">
              <Link className="chain-id" href={`/chains/${correction.chainId}`}>#{correction.chainId}</Link>
              {correction.totalAmount !== null && (
                <span className="payout-corrections__amount">{correction.totalAmount.toLocaleString()} {correction.rewardUnit ?? "units"}</span>
              )}
              <time dateTime={correction.revertedAt}>{new Date(correction.revertedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
            </div>
            <p className="payout-corrections__reason">{correction.reason}</p>
            <small>Withdrawn by {correction.revertedByName}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
