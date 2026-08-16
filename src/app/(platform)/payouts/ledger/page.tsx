import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { PayoutRegister } from "@/components/rewards/payout-ledger";
import { getPayoutWorkspace } from "@/lib/rewards/payout-workspace";

export const metadata: Metadata = { title: "Payout register" };

export default async function PayoutRegisterPage() {
  const { ledger } = await getPayoutWorkspace();

  return (
    <div className="payout-route-view payout-route-view--register">
      <div className="payout-process-guide">
        <span><ShieldCheck size={17} /></span>
        <p><strong>Use the ledger as the source of truth</strong><small>Filter the persisted register, resolve held or approved rows first, and export the exact control view used for reconciliation.</small></p>
      </div>
      <PayoutRegister entries={ledger.entries} message={ledger.message} databaseAvailable={ledger.databaseAvailable} />
    </div>
  );
}
