import type { TornChainHistoryItem, TornRosterMember } from "@/lib/torn/workspace-types";

export interface ChainAnalyticsSummary {
  sampleSize: number;
  totalHits: number;
  totalRespect: number;
  averageHits: number;
  averageRespect: number;
  averageDurationSeconds: number;
  respectPerHit: number;
  bestChain: TornChainHistoryItem | null;
  trendPercent: number | null;
  consistencyPercent: number | null;
  headline: string;
  summary: string;
}

export interface RosterAnalyticsSummary {
  total: number;
  okay: number;
  okayPercent: number;
  active15Minutes: number;
  activeHour: number;
  activeDay: number;
  inactiveDay: number;
  statuses: Array<{ label: string; count: number; percent: number }>;
  positions: Array<{ label: string; count: number; percent: number }>;
}

export function summarizeChainHistory(history: TornChainHistoryItem[]): ChainAnalyticsSummary {
  const sampleSize = history.length;
  const totalHits = sum(history.map((chain) => chain.hits));
  const totalRespect = sum(history.map((chain) => chain.respect));
  const averageHits = sampleSize ? totalHits / sampleSize : 0;
  const averageRespect = sampleSize ? totalRespect / sampleSize : 0;
  const averageDurationSeconds = sampleSize
    ? sum(history.map((chain) => Math.max(0, chain.endedAt - chain.startedAt))) / sampleSize
    : 0;
  const bestChain = history.reduce<TornChainHistoryItem | null>(
    (best, chain) => !best || chain.hits > best.hits ? chain : best,
    null,
  );
  const trendPercent = chainTrend(history);
  const consistencyPercent = sampleSize > 1 && averageHits > 0
    ? clamp(100 - (standardDeviation(history.map((chain) => chain.hits), averageHits) / averageHits) * 100, 0, 100)
    : null;

  const headline = trendPercent === null
    ? "Building a reliable chain baseline."
    : trendPercent > 5
      ? "Recent chains are running above the prior baseline."
      : trendPercent < -5
        ? "Recent chains are below the prior baseline."
        : "Recent chain output is holding steady.";
  const summary = sampleSize === 0
    ? "No completed-chain records are available for analysis."
    : `${Math.round(averageHits).toLocaleString()} average hits across ${sampleSize} returned chain${sampleSize === 1 ? "" : "s"}; the strongest reached ${bestChain?.hits.toLocaleString() ?? "—"}.`;

  return {
    sampleSize,
    totalHits,
    totalRespect,
    averageHits,
    averageRespect,
    averageDurationSeconds,
    respectPerHit: totalHits > 0 ? totalRespect / totalHits : 0,
    bestChain,
    trendPercent,
    consistencyPercent,
    headline,
    summary,
  };
}

export function summarizeRoster(roster: TornRosterMember[], checkedAt: string): RosterAnalyticsSummary {
  const checkedAtSeconds = Math.floor(Date.parse(checkedAt) / 1_000);
  const total = roster.length;
  const okay = roster.filter((member) => member.status.toLowerCase() === "okay").length;
  const active15Minutes = recentCount(roster, checkedAtSeconds, 15 * 60);
  const activeHour = recentCount(roster, checkedAtSeconds, 60 * 60);
  const activeDay = recentCount(roster, checkedAtSeconds, 24 * 60 * 60);
  return {
    total,
    okay,
    okayPercent: total ? (okay / total) * 100 : 0,
    active15Minutes,
    activeHour,
    activeDay,
    inactiveDay: Math.max(0, total - activeDay),
    statuses: groupValues(roster.map((member) => member.status || "Unavailable"), total),
    positions: groupValues(roster.map((member) => member.position || "Unassigned"), total),
  };
}

function chainTrend(history: TornChainHistoryItem[]): number | null {
  if (history.length < 4) return null;
  const groupSize = Math.min(3, Math.floor(history.length / 2));
  const recent = average(history.slice(0, groupSize).map((chain) => chain.hits));
  const prior = average(history.slice(groupSize, groupSize * 2).map((chain) => chain.hits));
  return prior > 0 ? ((recent - prior) / prior) * 100 : null;
}

function recentCount(roster: TornRosterMember[], checkedAt: number, windowSeconds: number): number {
  if (!Number.isFinite(checkedAt)) return 0;
  return roster.filter((member) => member.lastActionAt >= checkedAt - windowSeconds).length;
}

function groupValues(values: string[], total: number): Array<{ label: string; count: number; percent: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, percent: total ? (count / total) * 100 : 0 }))
    .toSorted((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function standardDeviation(values: number[], mean: number): number {
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function average(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
