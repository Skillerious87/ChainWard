import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { PayoutOverview } from "@/components/rewards/payout-ledger";
import { getPayoutWorkspace } from "@/lib/rewards/payout-workspace";

export const metadata: Metadata = { title: "Payout overview" };

export default async function PayoutsPage() {
  const { ledger } = await getPayoutWorkspace();

  return <div className="payout-route-view payout-route-view--overview">
    <div className="payout-process-guide"><span><ShieldCheck size={17} /></span><p><strong>Safe payment flow</strong><small>Review a completed chain → confirm every calculated member reward → send items in Torn → mark the chain PAID. Torn activity alone never changes this ledger.</small></p></div>
    <PayoutOverview entries={ledger.entries} message={ledger.message} databaseAvailable={ledger.databaseAvailable} />
  </div>;
}
