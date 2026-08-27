"use client";

import { BadgeCheck, CalendarCheck2, ChevronRight, CircleDollarSign, ReceiptText, ShieldCheck, Undo2, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { markChainPaid, revertChainPayment } from "@/app/(platform)/chains/actions";
import { Dialog } from "@/components/ui/dialog";
import { notify } from "@/lib/client-actions";
import type { ChainRewardPreview, ChainSettlement } from "@/lib/rewards/chain-settlement";

export function ChainPaymentControl({ chainId, preview, settlement }: { chainId: number; preview: ChainRewardPreview; settlement: ChainSettlement | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const paid = settlement?.status === "PAID";
  const display = settlement ?? preview;
  const recipientCount = display.members.filter((member) => member.amount > 0).length;

  function closeDialog(): void {
    setOpen(false);
    setReverting(false);
    setReason("");
  }

  async function confirmRevert(): Promise<void> {
    if (reason.trim().length < 8) {
      notify({ title: "Reason required", description: "Record why this payout is being withdrawn before confirming.", tone: "warning" });
      throw new Error("A reason is required.");
    }
    setWorking(true);
    try {
      await revertChainPayment({ chainId, reason: reason.trim() });
      notify({ title: `Chain #${chainId} returned to unpaid`, description: "The payout acknowledgement was withdrawn. The reward calculation is unchanged.", tone: "success" });
      closeDialog();
      router.refresh();
    } catch (error) {
      notify({ title: "Paid status not withdrawn", description: error instanceof Error ? error.message : "Try again.", tone: "danger" });
      throw error;
    } finally { setWorking(false); }
  }

  async function confirmPaid(): Promise<void> {
    setWorking(true);
    try {
      const result = await markChainPaid({ chainId });
      notify({ title: `Chain #${chainId} marked paid`, description: `${result.totalAmount.toLocaleString()} ${result.rewardUnit} recorded as paid.`, tone: "success" });
      setOpen(false);
      router.refresh();
    } catch (error) {
      notify({ title: "Paid status not saved", description: error instanceof Error ? error.message : "Try again.", tone: "danger" });
      throw error;
    } finally { setWorking(false); }
  }

  if (!display.available) return <Link href="/rewards" className="button button--quiet chain-payment-unavailable"><CircleDollarSign size={15} /> Configure rewards</Link>;

  return <>
    <button className={paid ? "chain-payment-button chain-payment-button--paid" : "chain-payment-button"} onClick={() => { setReverting(false); setOpen(true); }} aria-label={paid ? `View paid record for chain ${chainId}` : `Mark chain ${chainId} paid`}>
      <span className="chain-payment-button__seal">{paid ? <BadgeCheck size={22} /> : <CircleDollarSign size={21} />}</span>
      <span className="chain-payment-button__status"><small>Payment status</small><strong>{paid ? "Paid" : "Awaiting payment"}</strong></span>
      <span className="chain-payment-button__amount"><strong>{display.totalAmount.toLocaleString()}</strong><small>{display.rewardUnit} · {recipientCount} recipient{recipientCount === 1 ? "" : "s"}</small></span>
      <ChevronRight className="chain-payment-button__chevron" size={17} />
    </button>
    <Dialog
      open={open}
      className={reverting ? "dialog--revert-paid" : paid ? "dialog--chain-paid" : "dialog--mark-paid"}
      title={reverting ? `Return chain #${chainId} to unpaid?` : paid ? `Chain #${chainId} is paid` : `Mark chain #${chainId} as paid?`}
      description={reverting ? "Use this only to correct a payout that was recorded by mistake." : paid ? "This payout acknowledgement is stored in the workspace database." : "Confirm only after every eligible member reward has been sent. Zero-reward members are recorded as not eligible."}
      confirmLabel={reverting ? (working ? "Withdrawing…" : "Withdraw paid status") : paid ? "Done" : working ? "Saving…" : "Confirm all rewards paid"}
      cancelLabel={reverting ? "Keep as paid" : "Cancel"}
      destructive={reverting}
      hideCancel={paid && !reverting}
      confirmDisabled={working || (reverting && reason.trim().length < 8)}
      onConfirm={reverting ? confirmRevert : paid ? closeDialog : confirmPaid}
      onClose={reverting ? () => { setReverting(false); setReason(""); } : closeDialog}
    >
      {reverting ? (
        <>
          <div className="payment-confirmation payment-confirmation--revert">
            <span><Undo2 size={23} /></span>
            <div>
              <p className="eyebrow">Correcting a payout record</p>
              <h3>{display.totalAmount.toLocaleString()} {display.rewardUnit}</h3>
              <p>The chain returns to its calculated but unpaid state. The reward calculation, scheme version, and member amounts are all unchanged — only the acknowledgement that they were sent is withdrawn.</p>
            </div>
          </div>
          {/* The withdrawal is kept with its reason, so a later review can tell
              a correction apart from an unexplained change. */}
          <label className="payment-revert-reason">
            <span><strong>Reason for withdrawal</strong><small>Stored with the correction · required</small></span>
            <textarea
              value={reason}
              maxLength={300}
              rows={3}
              autoFocus
              placeholder="For example: marked paid before the Xanax was actually sent."
              onChange={(event) => setReason(event.target.value)}
            />
            <small className={reason.trim().length >= 8 ? "payment-revert-reason__count payment-revert-reason__count--ready" : "payment-revert-reason__count"}>
              {reason.trim().length < 8 ? `${8 - reason.trim().length} more character${8 - reason.trim().length === 1 ? "" : "s"} needed` : `${reason.trim().length} / 300`}
            </small>
          </label>
        </>
      ) : (
        <>
          <div className={paid ? "payment-confirmation payment-confirmation--paid" : "payment-confirmation"}>
            <span>{paid ? <ShieldCheck size={23} /> : <CircleDollarSign size={23} />}</span>
            <div><p className="eyebrow">{paid ? "Recorded payment" : "Payout acknowledgement"}</p><h3>{display.totalAmount.toLocaleString()} {display.rewardUnit}</h3><p>{paid ? "This settlement has been acknowledged and recorded in the workspace ledger." : "Confirm only after the complete calculated payout has been sent."}</p></div>
          </div>
          <dl className="payment-record-grid"><div><dt><UsersRound size={13} />Recipients</dt><dd>{recipientCount} eligible member{recipientCount === 1 ? "" : "s"}</dd></div><div><dt><ReceiptText size={13} />Reward scheme</dt><dd>{display.schemeName}</dd></div><div><dt><ShieldCheck size={13} />Scheme version</dt><dd>Version {display.schemeVersion}</dd></div><div><dt><CalendarCheck2 size={13} />{paid ? "Recorded" : "Status"}</dt><dd>{paid && settlement?.paidAt ? new Date(settlement.paidAt).toLocaleString("en-GB") : "Ready for confirmation"}</dd></div></dl>
          {paid && <button type="button" className="payment-revert-button" onClick={() => setReverting(true)}>
            <Undo2 size={14} /> Recorded by mistake? Return this chain to unpaid
          </button>}
        </>
      )}
    </Dialog>
  </>;
}
