import type { Metadata } from "next";
import { PayoutCorrections } from "@/components/rewards/payout-corrections";
import { getPayoutWorkspace } from "@/lib/rewards/payout-workspace";

export const metadata: Metadata = { title: "Payout corrections" };

export default async function PayoutCorrectionsPage() {
  const { corrections } = await getPayoutWorkspace();
  return <div className="payout-route-view"><PayoutCorrections corrections={corrections} /></div>;
}
