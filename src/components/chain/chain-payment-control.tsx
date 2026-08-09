"use client";

import { BadgeCheck, CalendarCheck2, ChevronRight, CircleDollarSign, ReceiptText, ShieldCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { markChainPaid } from "@/app/(platform)/chains/actions";
import { Dialog } from "@/components/ui/dialog";
import { notify } from "@/lib/client-actions";
import type { ChainRewardPreview, ChainSettlement } from "@/lib/rewards/chain-settlement";

export function ChainPaymentControl({ chainId, preview, settlement }: { chainId: number; preview: ChainRewardPreview; settlement: ChainSettlement | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const paid = settlement?.status === "PAID";
  const display = settlement ?? preview;

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
    <button className={paid ? "chain-payment-button chain-payment-button--paid" : "chain-payment-button"} onClick={() => setOpen(true)} aria-label={paid ? `View paid record for chain ${chainId}` : `Mark chain ${chainId} paid`}>
      <span className="chain-payment-button__seal">{paid ? <BadgeCheck size={22} /> : <CircleDollarSign size={21} />}</span>
      <span className="chain-payment-button__status"><small>Payment status</small><strong>{paid ? "Paid" : "Awaiting payment"}</strong></span>
      <span className="chain-payment-button__amount"><strong>{display.totalAmount.toLocaleString()}</strong><small>{display.rewardUnit} · {display.members.length} member{display.members.length === 1 ? "" : "s"}</small></span>
      <ChevronRight className="chain-payment-button__chevron" size={17} />
    </button>
    <Dialog open={open} className={paid ? "dialog--chain-paid" : "dialog--mark-paid"} title={paid ? `Chain #${chainId} is paid` : `Mark chain #${chainId} as paid?`} description={paid ? "This immutable payout acknowledgement is stored in the workspace database." : "Confirm only after every listed member reward has been sent."} confirmLabel={paid ? "Done" : working ? "Saving…" : "Confirm all rewards paid"} hideCancel={paid} confirmDisabled={working} onConfirm={paid ? () => undefined : confirmPaid} onClose={() => setOpen(false)}>
      <div className={paid ? "payment-confirmation payment-confirmation--paid" : "payment-confirmation"}>
        <span>{paid ? <ShieldCheck size={23} /> : <CircleDollarSign size={23} />}</span>
        <div><p className="eyebrow">{paid ? "Recorded payment" : "Payout acknowledgement"}</p><h3>{display.totalAmount.toLocaleString()} {display.rewardUnit}</h3><p>{paid ? "This settlement has been acknowledged and locked in the workspace ledger." : "Confirm only after the complete calculated payout has been sent."}</p></div>
      </div>
      <dl className="payment-record-grid"><div><dt><UsersRound size={13} />Recipients</dt><dd>{display.members.length} member{display.members.length === 1 ? "" : "s"}</dd></div><div><dt><ReceiptText size={13} />Reward scheme</dt><dd>{display.schemeName}</dd></div><div><dt><ShieldCheck size={13} />Scheme version</dt><dd>Version {display.schemeVersion}</dd></div><div><dt><CalendarCheck2 size={13} />{paid ? "Recorded" : "Status"}</dt><dd>{paid && settlement?.paidAt ? new Date(settlement.paidAt).toLocaleString("en-GB") : "Ready for confirmation"}</dd></div></dl>
    </Dialog>
  </>;
}
