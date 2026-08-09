import { Activity, History, Target, Users } from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";
import type { TornChainHistoryItem, TornChainReportView } from "@/lib/torn/workspace-types";

export function StatStrip({ telemetry, report, history }: { telemetry: WorkspaceTelemetry; report: TornChainReportView | null; history: TornChainHistoryItem[] }) {
  const historyValues = history.slice(0, 8).toReversed().map((chain) => chain.hits);
  const stats = [
    { label: "Current chain", value: telemetry.chain?.current.toLocaleString() ?? "—", detail: telemetry.chain ? `Chain #${telemetry.chain.id}` : "No verified chain data", icon: Activity },
    { label: "Current target", value: telemetry.chain?.maximum.toLocaleString() ?? "—", detail: telemetry.chain ? `${telemetry.chain.timeoutSeconds}s timeout at last check` : "Not returned", icon: Target },
    { label: "Report contributors", value: report?.contributorCount.toLocaleString() ?? "—", detail: report ? `Matching report #${report.id}` : "No matching current report", icon: Users },
    { label: "Chains returned", value: history.length.toLocaleString(), detail: "Official completed-chain list", icon: History },
  ];
  return <section className="stat-strip" aria-label="Verified Torn statistics">{stats.map((stat) => { const Icon = stat.icon; return <div className="stat-item" key={stat.label}><div className="stat-item__heading"><span>{stat.label}</span><Icon size={16} /></div><div className="stat-item__body"><strong>{stat.value}</strong>{historyValues.length > 1 && <Sparkline values={historyValues} label="Recent completed-chain hit counts" />}</div><small>{stat.detail}</small></div>; })}</section>;
}
