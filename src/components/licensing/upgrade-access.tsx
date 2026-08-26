import { Check, Clock3, Crown, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { FactionAccessSummary } from "@/lib/licensing/types";

export function UpgradeAccess({ access, workspaceAuthorized }: { access: FactionAccessSummary; workspaceAuthorized: boolean }) {
  const active = access.state === "active" && workspaceAuthorized;
  const memberApprovalRequired = access.state === "active" && !workspaceAuthorized;
  const pending = access.state === "pending";
  return <Link
    className={`topbar-upgrade${active ? " topbar-upgrade--active" : pending ? " topbar-upgrade--pending" : ""}`}
    href="/unlock"
    aria-label={active ? "View Chainward faction access" : memberApprovalRequired ? "Your player needs approval for this faction" : pending ? "View pending Chainward access request" : "Unlock Chainward features"}
  >
    <span className={`topbar-upgrade__icon${active ? " topbar-upgrade__icon--secured" : ""}`}>{pending ? <Clock3 size={16} /> : <Crown size={16} />}{active && <ShieldCheck size={10} />}</span>
    <span className="topbar-upgrade__copy"><strong>{active ? "Chainward protected" : memberApprovalRequired ? "Player approval required" : pending ? "Request pending · locked" : "Workspace locked"}</strong><small>{active ? access.label : memberApprovalRequired ? "Access does not transfer between factions" : "Unlock complete access"}</small></span>
    {(active || pending) && <span className="topbar-upgrade__status"><Check size={11} /></span>}
  </Link>;
}
