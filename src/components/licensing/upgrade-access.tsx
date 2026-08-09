import { Check, Clock3, Crown, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { FactionAccessSummary } from "@/lib/licensing/types";

export function UpgradeAccess({ access }: { access: FactionAccessSummary }) {
  const active = access.state === "active";
  const pending = access.state === "pending";
  return <Link
    className={`topbar-upgrade${active ? " topbar-upgrade--active" : pending ? " topbar-upgrade--pending" : ""}`}
    href="/unlock"
    aria-label={active ? "View Chainward faction access" : pending ? "View pending Chainward access request" : "Unlock Chainward features"}
  >
    <span className={`topbar-upgrade__icon${active ? " topbar-upgrade__icon--secured" : ""}`}>{pending ? <Clock3 size={16} /> : <Crown size={16} />}{active && <ShieldCheck size={10} />}</span>
    <span className="topbar-upgrade__copy"><strong>{active ? "Chainward protected" : pending ? "Request pending" : "Unlock Chainward"}</strong><small>{access.label}</small></span>
    {(active || pending) && <span className="topbar-upgrade__status"><Check size={11} /></span>}
  </Link>;
}
