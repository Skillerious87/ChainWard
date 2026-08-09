import { Activity, AlertTriangle, KeyRound, Users } from "lucide-react";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";

export function AdminKpis({ factionCount, activeLicenseCount, reviewCount, telemetry }: { factionCount: number; activeLicenseCount: number; reviewCount: number; telemetry: WorkspaceTelemetry }) {
  return <section className="admin-kpis"><div><span><Users size={18} /></span><small>Stored factions</small><strong>{factionCount}</strong><em>Application database</em></div><div><span><KeyRound size={18} /></span><small>Active licences</small><strong>{activeLicenseCount}</strong><em>Stored licence records</em></div><div><span className={reviewCount ? "warning-icon" : undefined}><AlertTriangle size={18} /></span><small>Review queue</small><strong>{reviewCount}</strong><em>Owner action required</em></div><div><span><Activity size={18} /></span><small>Torn API</small><strong className="health-value"><i /> {telemetry.source === "live" ? "Verified" : "Unavailable"}</strong><em>{new Date(telemetry.checkedAt).toLocaleTimeString("en-GB")}</em></div></section>;
}
