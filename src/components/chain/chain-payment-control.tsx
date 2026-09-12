"use client";

import { BadgeCheck, CalendarCheck2, ChevronRight, CircleDollarSign, Clock3, ReceiptText, ShieldCheck, Undo2, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cancelChainPaymentRevertRequest, markChainPaid, revertChainPayment } from "@/app/(platform)/chains/actions";
import { Dialog } from "@/components/ui/dialog";
import { notify } from "@/lib/client-actions";
import type { ChainRewardPreview, ChainSettlement, PendingPayoutRevertRequest } from "@/lib/rewards/chain-settlement";

export function ChainPaymentControl({ chainId, preview, settlement, pendingRevert, currentTornUserId }: { chainId: number; preview: ChainRewardPreview; settlement: ChainSettlement | null; pendingRevert: PendingPayoutRevertRequest | null; currentTornUserId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const paid = settlement?.status === "PAID";
  const display = settlement ?? preview;
  const recipientCount = display.members.filter((member) => member.amount > 0).length;

  // Reverting a paid chain retracts an assertion that members were already
  // sent their reward, so it always needs a second, different administrator
  // to confirm - the requester can never be the one who applies it.
  const isRequester = pendingRevert !== null && pendingRevert.requestedByTornId === currentTornUserId;
  const awaitingSecondAdmin = pendingRevert !== null && isRequester;
  const readyToConfirm = pendingRevert !== null && !isRequester;

  function closeDialog(): void {
    setOpen(false);
    setReverting(false);
    setReason("");
  }

  async function confirmRevert(): Promise<void> {
    if (!readyToConfirm && reason.trim().length < 8) {
      notify({ title: "Reason required", description: "Record why this payout is being withdrawn before confirming.", tone: "warning" });
      throw new Error("A reason is required.");
    }
    setWorking(true);
    try {
      const result = await revertChainPayment({ chainId, reason: reason.trim() });
      if (result.status === "requested") {
        notify({ title: "Withdrawal requested", description: "A different administrator must open this chain and confirm before it returns to unpaid.", tone: "info" });
      } else {
        notify({ title: `Chain #${chainId} returned to unpaid`, description: "The payout acknowledgement was withdrawn. The reward calculation is unchanged.", tone: "success" });
      }
      closeDialog();
      router.refresh();
    } catch (error) {
      notify({ title: "Paid status not withdrawn", description: error instanceof Error ? error.message : "Try again.", tone: "danger" });
      throw error;
    } finally { setWorking(false); }
  }

  async function cancelRequest(): Promise<void> {
    setWorking(true);
    try {
      await cancelChainPaymentRevertRequest({ chainId });
      notify({ title: "Withdrawal request cancelled", tone: "success" });
      closeDialog();
      router.refresh();
    } catch (error) {
      notify({ title: "Request not cancelled", description: error instanceof Error ? error.message : "Try again.", tone: "danger" });
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
      <span className="chain-payment-button__status">
        <small>Payment status</small>
        <strong>{paid ? "Paid" : "Awaiting payment"}</strong>
        {pendingRevert && <em className="chain-payment-button__pending"><Clock3 size={11} /> {awaitingSecondAdmin ? "Withdrawal awaiting a second admin" : "Withdrawal ready to confirm"}</em>}
      </span>
      <span className="chain-payment-button__amount"><strong>{display.totalAmount.toLocaleString()}</strong><small>{display.rewardUnit} · {recipientCount} recipient{recipientCount === 1 ? "" : "s"}</small></span>
      <ChevronRight className="chain-payment-button__chevron" size={17} />
    </button>
    <Dialog
      open={open}
      className={reverting ? "dialog--revert-paid" : paid ? "dialog--chain-paid" : "dialog--mark-paid"}
      title={reverting
        ? awaitingSecondAdmin ? `Withdrawal pending for chain #${chainId}` : readyToConfirm ? `Confirm withdrawal for chain #${chainId}?` : `Return chain #${chainId} to unpaid?`
        : paid ? `Chain #${chainId} is paid` : `Mark chain #${chainId} as paid?`}
      description={reverting
        ? awaitingSecondAdmin ? "Your request is saved. Any other payout administrator can open this chain to confirm it — you cannot confirm your own request."
          : readyToConfirm ? `${pendingRevert!.requestedByName} requested this withdrawal. A different administrator must review and confirm it before it applies.`
            : "This is a high-risk action: it requires a second, different administrator to confirm before the chain actually returns to unpaid."
        : paid ? "This payout acknowledgement is stored in the workspace database." : "Confirm only after every eligible member reward has been sent. Zero-reward members are recorded as not eligible."}
      confirmLabel={reverting
        ? awaitingSecondAdmin ? (working ? "Cancelling…" : "Cancel request") : working ? (readyToConfirm ? "Confirming…" : "Requesting…") : readyToConfirm ? "Confirm & withdraw" : "Request withdrawal"
        : paid ? "Done" : working ? "Saving…" : "Confirm all rewards paid"}
      cancelLabel={reverting ? (awaitingSecondAdmin ? "Close" : "Not now") : "Cancel"}
      destructive={reverting}
      hideCancel={paid && !reverting}
      confirmDisabled={working || (reverting && !awaitingSecondAdmin && !readyToConfirm && reason.trim().length < 8)}
      onConfirm={reverting ? (awaitingSecondAdmin ? cancelRequest : confirmRevert) : paid ? closeDialog : confirmPaid}
      onClose={reverting ? () => { setReverting(false); setReason(""); } : closeDialog}
    >
      {reverting ? (
        <>
          <div className="payment-confirmation payment-confirmation--revert">
            <span><Undo2 size={23} /></span>
            <div>
              <p className="eyebrow">{awaitingSecondAdmin ? "Awaiting a second administrator" : readyToConfirm ? "Ready for your confirmation" : "Correcting a payout record"}</p>
              <h3>{display.totalAmount.toLocaleString()} {display.rewardUnit}</h3>
              <p>The chain returns to its calculated but unpaid state. The reward calculation, scheme version, and member amounts are all unchanged — only the acknowledgement that they were sent is withdrawn.</p>
            </div>
          </div>
          {pendingRevert && (awaitingSecondAdmin || readyToConfirm) && (
            <div className="payment-revert-pending">
              <p><strong>Requested by</strong> {pendingRevert.requestedByName}, {new Date(pendingRevert.requestedAt).toLocaleString("en-GB")}</p>
              <p className="payment-revert-pending__reason">“{pendingRevert.reason}”</p>
            </div>
          )}
          {/* The withdrawal is kept with its reason, so a later review can tell
              a correction apart from an unexplained change. */}
          {!awaitingSecondAdmin && <label className="payment-revert-reason">
            <span><strong>{readyToConfirm ? "Your reason for confirming" : "Reason for withdrawal"}</strong><small>Stored with the correction · required</small></span>
            <textarea
              value={reason}
              maxLength={300}
              rows={3}
              autoFocus
              placeholder={readyToConfirm ? "For example: verified with the requester, agree this was a mistake." : "For example: marked paid before the Donator Packs were actually sent."}
              onChange={(event) => setReason(event.target.value)}
            />
            <small className={reason.trim().length >= 8 ? "payment-revert-reason__count payment-revert-reason__count--ready" : "payment-revert-reason__count"}>
              {reason.trim().length < 8 ? `${8 - reason.trim().length} more character${8 - reason.trim().length === 1 ? "" : "s"} needed` : `${reason.trim().length} / 300`}
            </small>
          </label>}
        </>
      ) : (
        <>
          <div className={paid ? "payment-confirmation payment-confirmation--paid" : "payment-confirmation"}>
            <span>{paid ? <ShieldCheck size={23} /> : <CircleDollarSign size={23} />}</span>
            <div><p className="eyebrow">{paid ? "Recorded payment" : "Payout acknowledgement"}</p><h3>{display.totalAmount.toLocaleString()} {display.rewardUnit}</h3><p>{paid ? "This settlement has been acknowledged and recorded in the workspace ledger." : "Confirm only after the complete calculated payout has been sent."}</p></div>
          </div>
          <dl className="payment-record-grid"><div><dt><UsersRound size={13} />Recipients</dt><dd>{recipientCount} eligible member{recipientCount === 1 ? "" : "s"}</dd></div><div><dt><ReceiptText size={13} />Reward scheme</dt><dd>{display.schemeName}</dd></div><div><dt><ShieldCheck size={13} />Scheme version</dt><dd>Version {display.schemeVersion}</dd></div><div><dt><CalendarCheck2 size={13} />{paid ? "Recorded" : "Status"}</dt><dd>{paid && settlement?.paidAt ? new Date(settlement.paidAt).toLocaleString("en-GB") : "Ready for confirmation"}</dd></div></dl>
          {paid && pendingRevert && <div className="payment-revert-pending payment-revert-pending--inline">
            <p><Clock3 size={13} /> {awaitingSecondAdmin ? "You requested a withdrawal — awaiting a second administrator to confirm." : `${pendingRevert.requestedByName} requested a withdrawal — you can confirm it.`}</p>
          </div>}
          {paid && <button type="button" className="payment-revert-button" onClick={() => setReverting(true)}>
            <Undo2 size={14} /> {pendingRevert ? (awaitingSecondAdmin ? "Cancel the pending withdrawal request" : "Review and confirm the withdrawal request") : "Recorded by mistake? Return this chain to unpaid"}
          </button>}
        </>
      )}
    </Dialog>
  </>;
}
