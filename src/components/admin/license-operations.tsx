import { BadgeCheck, Clock3, ExternalLink, Fingerprint, History, PackageCheck, Radio, ShieldCheck } from "lucide-react";
import { TornUserName } from "@/components/ui/torn-user-link";
import { PLATFORM_OWNER } from "@/lib/auth/platform-owner";
import type { AccessAuditView, ActiveLicenseView } from "@/lib/licensing/request-store";

export function PurchaseReviewGuide() {
  return <section className="admin-procedure" aria-labelledby="purchase-procedure-title">
    <header><span><ShieldCheck size={19} /></span><div><p className="eyebrow">Owner operating procedure</p><h2 id="purchase-procedure-title">Purchase review lifecycle</h2><p>One deliberate path from faction request to auditable access.</p></div><a href={PLATFORM_OWNER.profileUrl} target="_blank" rel="noreferrer">Open Torn profile <ExternalLink size={13} /></a></header>
    <ol><li><span>1</span><p><strong>Match the identities</strong><small>Confirm the Torn sender, faction ID, request ID, and CW-… payment reference.</small></p></li><li><span>2</span><p><strong>Verify the transfer</strong><small>Check the expected Xanax quantity in Torn. Chainward never claims to verify this automatically.</small></p></li><li><span>3</span><p><strong>Activate once</strong><small>Type the exact reference and confirm the checklist. Conflicting active licences are blocked.</small></p></li><li><span>4</span><p><strong>Preserve the audit trail</strong><small>The reviewer, decision, timestamp, plan, and reference are committed together.</small></p></li></ol>
  </section>;
}

export function LicenseRegistry({ licenses }: { licenses: ActiveLicenseView[] }) {
  return <section className="data-section active-license-registry">
    <div className="section-heading"><div><h2>Active licence register</h2><p>{licenses.length} currently valid faction licence{licenses.length === 1 ? "" : "s"}</p></div><span className="registry-shield"><BadgeCheck size={18} /></span></div>
    {licenses.length ? <div className="license-register-list">{licenses.map((license) => <article key={license.licenseId}>
      <span><ShieldCheck size={17} /></span>
      <div><strong>{license.faction}</strong><small>Faction {license.factionId} · Licence {license.licenseId.slice(0, 8).toUpperCase()}</small></div>
      <div><code>{license.reference}</code><small>{license.approvedBy ? <>Approved by <TornUserName name={license.approvedBy.name} tornUserId={license.approvedBy.tornUserId} /></> : `${license.term} access`}</small></div>
      <div><strong>{license.expiresAt ? new Date(license.expiresAt).toLocaleDateString("en-GB") : "No expiry"}</strong><small>{license.expiresAt ? "Expires" : "Permanent"}</small></div>
    </article>)}</div> : <div className="table-empty"><ShieldCheck size={20} /> No active licence records are stored.</div>}
  </section>;
}

export function AccessAuditTimeline({ events }: { events: AccessAuditView[] }) {
  return <section className="panel access-audit-panel">
    <div className="section-heading"><div><h2>Recent access audit</h2><p>Immutable purchase and review events</p></div><History size={17} /></div>
    {events.length ? <div className="access-audit-list">{events.map((event) => <div key={event.id}>
      <span>{auditIcon(event.action)}</span>
      <p><strong>{event.action}</strong><small>{event.reference ?? "No payment reference"}</small></p>
      <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("en-GB")}</time>
      {event.actor ? <TornUserName name={event.actor.name} tornUserId={event.actor.tornUserId} /> : <em>System</em>}
    </div>)}</div> : <div className="table-empty">No access audit events have been recorded yet.</div>}
  </section>;
}

function auditIcon(action: string) {
  if (action === "Approved") return <PackageCheck size={15} />;
  if (action === "Information requested") return <Clock3 size={15} />;
  if (action === "Submitted") return <Radio size={15} />;
  return <Fingerprint size={15} />;
}
