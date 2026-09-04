import type { Metadata } from "next";
import { ExportButton } from "@/components/ui/action-controls";
import { PageHeader } from "@/components/ui/page-header";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getPayoutWorkspace } from "@/lib/rewards/payout-workspace";

export const metadata: Metadata = { title: "Payout ledger" };

export default async function PayoutsLayout({ children }: { children: React.ReactNode }) {
  await requireLicensedPage();
  const { ledger } = await getPayoutWorkspace();
  const exportRows = ledger.entries.map((entry) => ({
    chainId: entry.chainId,
    tornUserId: entry.tornUserId,
    member: entry.memberName,
    tier: entry.tierLabel ?? "",
    amount: entry.amount,
    unit: entry.rewardUnit,
    status: entry.status,
    createdAt: entry.createdAt,
    processedAt: entry.processedAt ?? "",
    processedByName: entry.processedBy?.name ?? "",
    processedByTornId: entry.processedBy?.tornUserId ?? "",
  }));

  return (
    <div className="page-stack payout-workspace">
      <PageHeader
        eyebrow="Reward operations"
        title="Payout ledger"
        description="Reconcile reward decisions, member liability, payment acknowledgements, and settlement corrections without losing the audit trail."
        actions={<ExportButton filename="chainward-payout-ledger.csv" label="Export complete ledger" rows={exportRows} />}
      />
      <div className="payout-workspace__view">{children}</div>
    </div>
  );
}
