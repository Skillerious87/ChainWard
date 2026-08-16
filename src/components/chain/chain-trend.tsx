import { Flame, TrendingDown, TrendingUp } from "lucide-react";
import type { ChainSettlementSummary } from "@/lib/rewards/chain-settlement";
import type { TornChainHistoryItem } from "@/lib/torn/workspace-types";

/**
 * The shape of recent chain performance, which a table of rows cannot show.
 *
 * Bars are ordered oldest to newest so the run reads left to right, and each
 * carries its settlement state, making an unpaid outlier visible without
 * scanning the register beneath it.
 */
export function ChainTrend({ chains, settlements }: { chains: TornChainHistoryItem[]; settlements: Record<number, ChainSettlementSummary> }) {
  if (chains.length < 2) return null;

  const recent = [...chains].sort((left, right) => left.endedAt - right.endedAt).slice(-24);
  const peak = Math.max(...recent.map((chain) => chain.hits), 1);
  const average = recent.reduce((total, chain) => total + chain.hits, 0) / recent.length;
  const best = recent.reduce((highest, chain) => (chain.hits > highest.hits ? chain : highest), recent[0]!);

  // Compare the two halves of the run rather than just the last two chains, so
  // a single quiet week does not read as a collapse.
  const midpoint = Math.floor(recent.length / 2);
  const earlierMean = mean(recent.slice(0, midpoint).map((chain) => chain.hits));
  const laterMean = mean(recent.slice(midpoint).map((chain) => chain.hits));
  const shift = earlierMean > 0 ? ((laterMean - earlierMean) / earlierMean) * 100 : 0;
  const rising = shift >= 0;

  return (
    <section className="chain-trend" aria-label="Recent chain trend">
      <header>
        <div>
          <p className="eyebrow">Recent form</p>
          <h2>Last {recent.length} completed chains</h2>
        </div>
        <div className="chain-trend__readouts">
          <span className={`chain-trend__shift chain-trend__shift--${rising ? "up" : "down"}`}>
            {rising ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {rising ? "+" : ""}{shift.toFixed(0)}%
            <small>recent half vs earlier</small>
          </span>
          <span className="chain-trend__best"><Flame size={13} /> Best {best.hits.toLocaleString()}<small>chain #{best.id}</small></span>
        </div>
      </header>

      <div className="chain-trend__plot">
        <div className="chain-trend__mean" style={{ bottom: `${(average / peak) * 100}%` }} aria-hidden="true"><span>avg {Math.round(average).toLocaleString()}</span></div>
        <ol>
          {recent.map((chain) => {
            const settlement = settlements[chain.id];
            const state = settlement?.status === "PAID" ? "paid" : settlement ? "calculated" : "open";
            return (
              <li key={chain.id} className={`chain-trend__bar chain-trend__bar--${state}${chain.id === best.id ? " chain-trend__bar--best" : ""}`}>
                <i style={{ height: `${Math.max(3, (chain.hits / peak) * 100)}%` }} />
                <span className="chain-trend__tip">
                  <strong>#{chain.id}</strong>
                  <em>{chain.hits.toLocaleString()} hits</em>
                  <small>{formatDay(chain.endedAt)} · {state === "paid" ? "Paid" : state === "calculated" ? "Calculated" : "Not settled"}</small>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <footer>
        <span className="chain-trend__key chain-trend__key--paid">Paid</span>
        <span className="chain-trend__key chain-trend__key--calculated">Calculated</span>
        <span className="chain-trend__key chain-trend__key--open">Not settled</span>
        <span className="chain-trend__range">{formatDay(recent[0]!.endedAt)} — {formatDay(recent.at(-1)!.endedAt)}</span>
      </footer>
    </section>
  );
}

function mean(values: number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function formatDay(timestamp: number): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(timestamp * 1_000);
}
