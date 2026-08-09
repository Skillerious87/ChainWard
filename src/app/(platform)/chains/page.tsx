import type { Metadata } from "next";
import { HistoryTable } from "@/components/chain/history-table";
import { PageHeader } from "@/components/ui/page-header";
import { ExportButton } from "@/components/ui/action-controls";
import { getCompletedChainHistory } from "@/lib/torn/workspace-data-service";
import { getChainSettlementSummaries } from "@/lib/rewards/chain-settlement";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const metadata: Metadata = { title: "Chain History" };

export default async function ChainHistoryPage() {
  const [result, telemetry] = await Promise.all([getCompletedChainHistory(), getWorkspaceTelemetry()]);
  const chains = result.data;
  const settlements = telemetry.faction ? await getChainSettlementSummaries(telemetry.faction.id, chains.map((chain) => chain.id)) : {};
  const totalHits = chains.reduce((sum, chain) => sum + chain.hits, 0);
  const totalRespect = chains.reduce((sum, chain) => sum + chain.respect, 0);
  const average = chains.length > 0 ? totalHits / chains.length : 0;
  return <div className="page-stack">
    <PageHeader eyebrow="History" title="Chain history" description="Completed-chain records retrieved directly from Torn. Open a chain to request its detailed report." actions={<ExportButton filename="chainward-chain-history.csv" label="Export history" rows={chains.map((chain) => ({ chainId: chain.id, hits: chain.hits, respect: chain.respect, startedAt: new Date(chain.startedAt * 1_000).toISOString(), endedAt: new Date(chain.endedAt * 1_000).toISOString() }))} />}/>
    <section className="history-summary"><div><small>Chains returned</small><strong>{result.available ? chains.length : "—"}</strong><span>Current API response</span></div><div><small>Total hits returned</small><strong>{result.available ? totalHits.toLocaleString() : "—"}</strong><span>No estimated history</span></div><div><small>Average returned chain</small><strong>{result.available ? Math.round(average).toLocaleString() : "—"}</strong><span>Derived from API records</span></div><div><small>Total respect returned</small><strong>{result.available ? totalRespect.toFixed(2) : "—"}</strong><span>Reported by Torn</span></div></section>
    <HistoryTable chains={chains} message={result.message} checkedAt={result.checkedAt} settlements={settlements} />
  </div>;
}
