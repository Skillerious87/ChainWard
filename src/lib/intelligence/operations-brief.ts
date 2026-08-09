import type { Route } from "next";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";
import type {
  TornChainHistoryItem,
  TornChainReportView,
  TornRosterMember,
} from "@/lib/torn/workspace-types";

export type OperationsBriefTone = "neutral" | "info" | "success" | "warning" | "danger";
export type OperationsSignalIcon = "timer" | "coverage" | "readiness" | "trend";

export interface OperationsSignal {
  label: string;
  value: string;
  detail: string;
  tone: OperationsBriefTone;
  icon: OperationsSignalIcon;
}

export interface OperationsBrief {
  state: "blocked" | "standby" | "live" | "critical" | "cooldown";
  tone: OperationsBriefTone;
  title: string;
  summary: string;
  rationale: string;
  action: { label: string; href: Route };
  confidence: { observed: number; total: number; label: string };
  signals: OperationsSignal[];
  checkedAt: string;
}

interface OperationsBriefInput {
  telemetry: WorkspaceTelemetry;
  report: TornChainReportView | null;
  reportAvailable: boolean;
  history: TornChainHistoryItem[];
  historyAvailable: boolean;
  roster: TornRosterMember[];
  rosterAvailable: boolean;
}

export function buildOperationsBrief(
  input: OperationsBriefInput,
  now = Date.now(),
): OperationsBrief {
  const { telemetry, report, history, roster } = input;
  const chain = telemetry.chain;
  const sourceCount = [
    telemetry.source === "live",
    input.reportAvailable,
    input.historyAvailable,
    input.rosterAvailable,
  ].filter(Boolean).length;
  const confidence = {
    observed: sourceCount,
    total: 4,
    label: sourceCount === 4 ? "Full signal coverage" : `${sourceCount} of 4 sources verified`,
  };
  const checkedAtMs = Date.parse(telemetry.checkedAt);
  const snapshotAge = Number.isFinite(checkedAtMs)
    ? Math.max(0, Math.floor((now - checkedAtMs) / 1_000))
    : 0;
  const effectiveTimeout = chain
    ? Math.max(0, chain.timeoutSeconds - snapshotAge)
    : 0;
  const progress = chain && chain.maximum > 0
    ? Math.min(100, (chain.current / chain.maximum) * 100)
    : 0;
  const remaining = chain ? Math.max(0, chain.maximum - chain.current) : 0;

  const priority = getPriority(telemetry, effectiveTimeout, progress, remaining);
  return {
    ...priority,
    confidence,
    checkedAt: telemetry.checkedAt,
    signals: [
      timeoutSignal(telemetry, effectiveTimeout),
      reportSignal(telemetry, report, input.reportAvailable),
      rosterSignal(telemetry, roster, input.rosterAvailable),
      trendSignal(history, input.historyAvailable),
    ],
  };
}

function getPriority(
  telemetry: WorkspaceTelemetry,
  timeoutSeconds: number,
  progress: number,
  remaining: number,
): Omit<OperationsBrief, "confidence" | "signals" | "checkedAt"> {
  const chain = telemetry.chain;
  if (telemetry.source !== "live") {
    return {
      state: "blocked",
      tone: "warning",
      title: "Connect verified data before making an operational call.",
      summary: "Chainward is withholding recommendations because Torn telemetry is unavailable.",
      rationale: "The brief never substitutes demo records, cached guesses, or inferred faction data.",
      action: { label: "Connect Torn API", href: "/connect" },
    };
  }
  if (!chain || chain.state === "idle" || chain.id === 0) {
    return {
      state: "standby",
      tone: "neutral",
      title: "No active chain pressure. Prepare the next operation.",
      summary: "Use the quiet window to verify the roster and make sure a reward scheme is ready.",
      rationale: "Torn reports no active chain, so preparation is the highest-value next step.",
      action: { label: "Review reward schemes", href: "/rewards" },
    };
  }
  if (chain.state === "cooldown") {
    return {
      state: "cooldown",
      tone: "info",
      title: "The chain is in cooldown. Move from execution to settlement.",
      summary: "Review the final report, calculate rewards, and acknowledge payment only after transfers are complete.",
      rationale: "The live chain state is cooldown, so report verification and reward settlement now take priority.",
      action: { label: "Review chain history", href: "/chains" },
    };
  }
  if (timeoutSeconds < 90) {
    return {
      state: "critical",
      tone: "danger",
      title: "Protect the chain now — the timeout window is critical.",
      summary: `${remaining.toLocaleString()} hits remain and the verified snapshot is ${progress.toFixed(1)}% complete.`,
      rationale: "Priority is driven by Torn's timeout value after accounting for snapshot age.",
      action: { label: "Open live command view", href: "/live-chain" },
    };
  }
  if (timeoutSeconds < 180) {
    return {
      state: "live",
      tone: "warning",
      title: "Timeout pressure is rising. Coordinate the next hit.",
      summary: `${remaining.toLocaleString()} hits remain with ${formatDuration(timeoutSeconds)} of observed runway.`,
      rationale: "The verified timeout is inside the three-minute watch window.",
      action: { label: "Open live command view", href: "/live-chain" },
    };
  }
  return {
    state: "live",
    tone: "success",
    title: "The chain window is stable. Keep participation moving.",
    summary: `${chain.current.toLocaleString()} of ${chain.maximum.toLocaleString()} hits are complete with ${formatDuration(timeoutSeconds)} of observed runway.`,
    rationale: "The verified timeout is outside the watch window and progress remains active.",
    action: { label: "Monitor live chain", href: "/live-chain" },
  };
}

function timeoutSignal(telemetry: WorkspaceTelemetry, seconds: number): OperationsSignal {
  if (telemetry.source !== "live" || !telemetry.chain) {
    return { label: "Timeout runway", value: "Unavailable", detail: "Requires live chain telemetry", tone: "neutral", icon: "timer" };
  }
  if (telemetry.chain.state !== "active") {
    return { label: "Timeout runway", value: titleCase(telemetry.chain.state), detail: "Current state returned by Torn", tone: "info", icon: "timer" };
  }
  return {
    label: "Timeout runway",
    value: formatDuration(seconds),
    detail: seconds < 90 ? "Critical window" : seconds < 180 ? "Watch window" : "Stable observed window",
    tone: seconds < 90 ? "danger" : seconds < 180 ? "warning" : "success",
    icon: "timer",
  };
}

function reportSignal(
  telemetry: WorkspaceTelemetry,
  report: TornChainReportView | null,
  available: boolean,
): OperationsSignal {
  if (!available) {
    return { label: "Report coverage", value: "Unavailable", detail: "Current report could not be verified", tone: "neutral", icon: "coverage" };
  }
  if (!report) {
    return { label: "Report coverage", value: "Not published", detail: "No report matches the current chain yet", tone: telemetry.chain?.state === "active" ? "warning" : "neutral", icon: "coverage" };
  }
  const factionMembers = telemetry.faction?.members ?? 0;
  const coverage = factionMembers > 0 ? (report.contributorCount / factionMembers) * 100 : null;
  return {
    label: "Report coverage",
    value: `${report.contributorCount} contributors`,
    detail: coverage === null ? `Matching report #${report.id}` : `${coverage.toFixed(0)}% of the current faction roster`,
    tone: "info",
    icon: "coverage",
  };
}

function rosterSignal(
  telemetry: WorkspaceTelemetry,
  roster: TornRosterMember[],
  available: boolean,
): OperationsSignal {
  if (!available) {
    return { label: "Roster readiness", value: "Unavailable", detail: "Faction members could not be verified", tone: "neutral", icon: "readiness" };
  }
  const checkedAt = Math.floor(Date.parse(telemetry.checkedAt) / 1_000);
  const activeRecently = roster.filter((member) => member.lastActionAt >= checkedAt - 15 * 60).length;
  const okay = roster.filter((member) => member.status.toLowerCase() === "okay").length;
  return {
    label: "Roster readiness",
    value: `${activeRecently} recently active`,
    detail: `${okay} of ${roster.length} members are marked Okay`,
    tone: activeRecently > 0 ? "success" : "neutral",
    icon: "readiness",
  };
}

function trendSignal(history: TornChainHistoryItem[], available: boolean): OperationsSignal {
  if (!available) {
    return { label: "Recent baseline", value: "Unavailable", detail: "Completed chains could not be verified", tone: "neutral", icon: "trend" };
  }
  if (history.length < 4) {
    return { label: "Recent baseline", value: `${history.length} chain${history.length === 1 ? "" : "s"}`, detail: "Four returned chains are needed for comparison", tone: "neutral", icon: "trend" };
  }
  const sampleSize = Math.min(3, Math.floor(history.length / 2));
  const recentAverage = average(history.slice(0, sampleSize).map((chain) => chain.hits));
  const priorAverage = average(history.slice(sampleSize, sampleSize * 2).map((chain) => chain.hits));
  const delta = priorAverage > 0 ? ((recentAverage - priorAverage) / priorAverage) * 100 : 0;
  const prefix = delta > 0 ? "+" : "";
  return {
    label: "Recent baseline",
    value: `${prefix}${delta.toFixed(0)}%`,
    detail: `Average hits · last ${sampleSize} vs prior ${sampleSize}`,
    tone: Math.abs(delta) < 1 ? "neutral" : "info",
    icon: "trend",
  };
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
