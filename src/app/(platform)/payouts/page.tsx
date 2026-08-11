import type { Metadata } from "next";
import { BadgeCheck, CircleDollarSign, Database, ShieldCheck } from "lucide-react";
import { PayoutLedger } from "@/components/rewards/payout-ledger";
import { ExportButton } from "@/components/ui/action-controls";
import { PageHeader } from "@/components/ui/page-header";
import { getPayoutLedger } from "@/lib/rewards/payout-store";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

export const metadata: Metadata = { title: "Payouts" };

export default async function PayoutsPage() {
  await requireLicensedPage();
  const [telemetry, roster] = await Promise.all([getWorkspaceTelemetry(), getFactionRoster()]);
  const knownNames = Object.fromEntries(roster.data.map((member) => [member.tornId, member.name]));
  const ledger = await getPayoutLedger(telemetry.faction?.id ?? null, knownNames);
  const paid = ledger.entries.filter((entry) => entry.status === "PAID");
  const chainCount = new Set(ledger.entries.map((entry) => entry.chainId)).size;
  const memberCount = new Set(ledger.entries.map((entry) => entry.tornUserId)).size;
  const units = new Set(paid.map((entry) => entry.rewardUnit));
  const paidTotal = units.size === 1 ? paid.reduce((sum, entry) => sum + entry.amount, 0) : null;

  return <div className="page-stack">
    <PageHeader eyebrow="Reward operations" title="Payout ledger" description="Every row comes from a persisted reward snapshot or an explicit chain-level PAID acknowledgement." actions={<ExportButton filename="chainward-payout-ledger.csv" label="Export ledger" rows={ledger.entries.map((entry) => ({ chainId: entry.chainId, tornUserId: entry.tornUserId, member: entry.memberName, tier: entry.tierLabel ?? "", amount: entry.amount, unit: entry.rewardUnit, status: entry.status, processedAt: entry.processedAt ?? "", processedByName: entry.processedBy?.name ?? "", processedByTornId: entry.processedBy?.tornUserId ?? "" }))} />} />
    <section className="payout-kpis"><div><span><Database size={18} /></span><small>Stored entries</small><strong>{ledger.databaseAvailable ? ledger.entries.length.toLocaleString() : "—"}</strong><em>{ledger.databaseAvailable ? "Persistent records" : "Storage unavailable"}</em></div><div><span><BadgeCheck size={18} /></span><small>Paid records</small><strong>{ledger.databaseAvailable ? paid.length.toLocaleString() : "—"}</strong><em>Explicit acknowledgements</em></div><div><span><CircleDollarSign size={18} /></span><small>Paid liability</small><strong>{paidTotal === null ? (paid.length ? "Mixed" : "0") : paidTotal.toLocaleString()} {units.size === 1 ? <span>{[...units][0]}</span> : null}</strong><em>{units.size > 1 ? "Multiple reward units" : "Recorded rewards"}</em></div><div><span><ShieldCheck size={18} /></span><small>Coverage</small><strong>{chainCount} <span>chains</span></strong><em>{memberCount} distinct members</em></div></section>
    <div className="payout-process-guide"><span><ShieldCheck size={17} /></span><p><strong>Safe payment flow</strong><small>Review a completed chain → confirm every calculated member reward → send items in Torn → mark the chain PAID. Torn activity alone never changes this ledger.</small></p></div>
    <PayoutLedger entries={ledger.entries} message={ledger.message} />
  </div>;
}
