import type { Metadata } from "next";
import { PayoutRecipients } from "@/components/rewards/payout-recipients";
import { getPayoutWorkspace } from "@/lib/rewards/payout-workspace";

export const metadata: Metadata = { title: "Payout recipients" };

export default async function PayoutRecipientsPage() {
  const { ledger } = await getPayoutWorkspace();
  return <div className="payout-route-view"><PayoutRecipients entries={ledger.entries} /></div>;
}
