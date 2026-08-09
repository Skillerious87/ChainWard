import { Activity, AlertTriangle, Database, ShieldCheck } from "lucide-react";
import type { DatabaseStatus } from "@/lib/data/database-status";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";

export function ServiceHealthPanel({ telemetry, database }: { telemetry: WorkspaceTelemetry; database: DatabaseStatus }) {
  return <aside className="panel service-health"><div className="section-heading"><div><h2>Verified service state</h2><p>No synthetic uptime or latency metrics</p></div></div><div className="health-list"><Health icon={Activity} name="Torn API" detail={telemetry.message} state={telemetry.source === "live" ? "Verified" : "Unavailable"} good={telemetry.source === "live"} /><Health icon={Database} name={database.label} detail={database.message} state={database.available ? "Ready" : database.configured ? "Attention" : "Required"} good={database.available} /><Health icon={ShieldCheck} name="Owner identity" detail="Checked against Torn user ID 3212954" state="Server checked" good /></div><p className="service-health__footnote">Last Torn check: {new Date(telemetry.checkedAt).toLocaleString("en-GB")}. Chainward does not display availability percentages unless monitoring data has actually been collected.</p></aside>;
}

function Health({ icon: Icon, name, detail, state, good }: { icon: typeof Activity; name: string; detail: string; state: string; good: boolean }) { return <div><span>{good ? <Icon size={16} /> : <AlertTriangle size={16} />}</span><p><strong>{name}</strong><small>{detail}</small></p><em className={good ? "health-good" : "health-watch"}><i />{state}</em></div>; }
