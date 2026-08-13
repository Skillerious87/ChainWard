import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { PayoutCorrections } from "@/components/rewards/payout-corrections";
import { PayoutLedger } from "@/components/rewards/payout-ledger";
import { PayoutRecipients } from "@/components/rewards/payout-recipients";
import { ExportButton } from "@/components/ui/action-controls";
import { PageHeader } from "@/components/ui/page-header";
import { getPayoutReverts } from "@/lib/rewards/chain-settlement";
import { getPayoutLedger } from "@/lib/rewards/payout-store";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Payouts" };

export default async function PayoutsPage() {
  await requireLicensedPage();
  const [telemetry, roster] = await Promise.all([getWorkspaceTelemetry(), getFactionRoster()]);
  const knownNames = Object.fromEntries(roster.data.map((member) => [member.tornId, member.name]));
  const [ledger, corrections] = await Promise.all([
    getPayoutLedger(telemetry.faction?.id ?? null, knownNames),
    telemetry.faction ? getPayoutReverts(telemetry.faction.id) : Promise.resolve([]),
  ]);

  return <div className="page-stack">
    <PageHeader
      eyebrow="Reward operations"
      title="Payout ledger"
      description="A control-grade view of every persisted reward decision, outstanding liability, paid acknowledgement, and settlement exception."
      actions={<ExportButton filename="chainward-payout-ledger.csv" label="Export complete ledger" rows={ledger.entries.map((entry) => ({ chainId: entry.chainId, tornUserId: entry.tornUserId, member: entry.memberName, tier: entry.tierLabel ?? "", amount: entry.amount, unit: entry.rewardUnit, status: entry.status, createdAt: entry.createdAt, processedAt: entry.processedAt ?? "", processedByName: entry.processedBy?.name ?? "", processedByTornId: entry.processedBy?.tornUserId ?? "" }))} />}
    />
    <div className="payout-process-guide"><span><ShieldCheck size={17} /></span><p><strong>Safe payment flow</strong><small>Review a completed chain → confirm every calculated member reward → send items in Torn → mark the chain PAID. Torn activity alone never changes this ledger.</small></p></div>
    <PayoutLedger entries={ledger.entries} message={ledger.message} databaseAvailable={ledger.databaseAvailable} />
    <div className="payout-insight-grid">
      <PayoutRecipients entries={ledger.entries} />
      <PayoutCorrections corrections={corrections} />
    </div>
  </div>;
}
