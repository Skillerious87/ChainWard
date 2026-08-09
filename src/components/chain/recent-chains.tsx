import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { TornChainHistoryItem } from "@/lib/torn/workspace-types";

export function RecentChains({ chains, message }: { chains: TornChainHistoryItem[]; message: string }) {
  return <section className="panel recent-chains"><div className="section-heading"><div><h2>Recent chains</h2><p>Completed-chain records returned by Torn</p></div><Link href="/chains">View history <ArrowUpRight size={14} /></Link></div><div className="recent-chain-list">{chains.slice(0, 4).map((chain) => <Link href={`/chains/${chain.id}`} className="recent-chain-row" key={chain.id}><span className="recent-chain-row__hits">{chain.hits.toLocaleString()}<small>hits</small></span><span><strong>{formatDate(chain.endedAt)}</strong><small>{formatDuration(chain.endedAt - chain.startedAt)}</small></span><span><strong>{chain.respect.toFixed(2)}</strong><small>respect</small></span><span className="payout-state">Torn report</span><ArrowUpRight size={15} /></Link>)}{chains.length === 0 && <div className="table-empty">{message}</div>}</div></section>;
}

function formatDate(timestamp: number): string { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(timestamp * 1_000); }
function formatDuration(seconds: number): string { const hours = Math.floor(seconds / 3_600); const minutes = Math.floor((seconds % 3_600) / 60); return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`; }
