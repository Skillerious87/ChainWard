import type { Metadata } from "next";
import { Activity, CircleDollarSign, History, Sparkles, Swords } from "lucide-react";
import { HistoryTable } from "@/components/chain/history-table";
import { PageHeader } from "@/components/ui/page-header";
import { ExportButton } from "@/components/ui/action-controls";
import { getCompletedChainHistory } from "@/lib/torn/workspace-data-service";
import { getChainSettlementSummaries } from "@/lib/rewards/chain-settlement";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const metadata: Metadata = { title: "Chain History" };

export default async function ChainHistoryPage() {
  await requireLicensedPage();
  const [result, telemetry] = await Promise.all([getCompletedChainHistory(), getWorkspaceTelemetry()]);
  const chains = result.data;
  const settlements = telemetry.faction ? await getChainSettlementSummaries(telemetry.faction.id, chains.map((chain) => chain.id)) : {};
  const totalHits = chains.reduce((sum, chain) => sum + chain.hits, 0);
  const totalRespect = chains.reduce((sum, chain) => sum + chain.respect, 0);
  const average = chains.length > 0 ? totalHits / chains.length : 0;
  const best = chains.reduce((highest, chain) => Math.max(highest, chain.hits), 0);
  const settledCount = Object.keys(settlements).length;
  const paidCount = Object.values(settlements).filter((settlement) => settlement.status === "PAID").length;
  return <div className="page-stack chain-history-page">
    <PageHeader eyebrow="History" title="Chain history" description="Completed-chain records retrieved directly from Torn. Open a chain to request its detailed report." actions={<ExportButton filename="chainward-chain-history.csv" label="Export history" rows={chains.map((chain) => ({ chainId: chain.id, hits: chain.hits, respect: chain.respect, startedAt: new Date(chain.startedAt * 1_000).toISOString(), endedAt: new Date(chain.endedAt * 1_000).toISOString() }))} />}/>
    {/* Settlement standing sits beside the Torn totals: knowing how many
        completed chains still need a reward calculation is the reason to open
        this screen at all. */}
    <section className="history-summary">
      <div><span><History size={17} /></span><small>Chains returned</small><strong>{result.available ? chains.length : "—"}</strong><span className="history-summary__note">Current API response</span></div>
      <div><span><Swords size={17} /></span><small>Total hits</small><strong>{result.available ? totalHits.toLocaleString() : "—"}</strong><span className="history-summary__note">Best chain {result.available ? best.toLocaleString() : "—"}</span></div>
      <div><span><Activity size={17} /></span><small>Average chain</small><strong>{result.available ? Math.round(average).toLocaleString() : "—"}</strong><span className="history-summary__note">Across returned records</span></div>
      <div><span><Sparkles size={17} /></span><small>Total respect</small><strong>{result.available ? totalRespect.toFixed(2) : "—"}</strong><span className="history-summary__note">Reported by Torn</span></div>
      <div className={settledCount < chains.length ? "history-summary__settlement history-summary__settlement--open" : "history-summary__settlement"}>
        <span><CircleDollarSign size={17} /></span>
        <small>Settlement</small>
        <strong>{settledCount}<em> / {chains.length}</em></strong>
        <span className="history-summary__note">{paidCount} marked paid</span>
      </div>
    </section>
    <HistoryTable chains={chains} message={result.message} checkedAt={result.checkedAt} settlements={settlements} />
  </div>;
}
