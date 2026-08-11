"use client";

import { ArrowRight, BarChart3, Check, CircleCheckBig, Clock3, Copy, Crown, ExternalLink, Fingerprint, Gem, History, LockKeyhole, MessageCircleQuestion, ShieldCheck, Sparkles, Users, WalletCards, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitAccessRequest } from "@/app/(platform)/licensing/actions";
import { InfoTip } from "@/components/ui/info-tip";
import { TornUserName } from "@/components/ui/torn-user-link";
import { notify } from "@/lib/client-actions";
import { createPaymentReference, licensePayment, licensePlans, type LicensePlanId } from "@/lib/licensing/pricing";
import type { FactionAccessSummary } from "@/lib/licensing/types";

const licenceBenefits = [
  "Advanced chain and roster analytics",
  "Versioned reward and payout controls",
  "Managed faction roles and access audit",
  "Every approved member, with no seat limits",
] as const;

export function UnlockWorkspace({ factionId, factionName, access }: { factionId: number | null; factionName: string | null; access: FactionAccessSummary }) {
  if (access.state === "active") return <ActiveAccess access={access} factionName={factionName} />;
  if (access.state === "pending") return <PendingAccess access={access} factionName={factionName} />;
  return <InactiveAccess factionId={factionId} factionName={factionName} />;
}

function InactiveAccess({ factionId, factionName }: { factionId: number | null; factionName: string | null }) {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<LicensePlanId>("quarterly");
  const [reference] = useState(() => factionId ? createPaymentReference(factionId) : null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const selected = licensePlans.find((plan) => plan.id === selectedPlan) ?? licensePlans[1];

  async function copyReference(): Promise<void> {
    if (!reference) return;
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
      notify({ title: "Payment reference copied", description: reference, tone: "success" });
    } catch {
      notify({ title: "Copy was blocked", description: `Select and copy ${reference} manually.`, tone: "warning" });
    }
  }

  async function submitRequest(): Promise<void> {
    if (!reference || !factionId || submitting) {
      notify({ title: "Verified faction required", description: "Connect the Torn API before requesting faction access.", tone: "warning" });
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitAccessRequest({ planId: selectedPlan, reference });
      window.dispatchEvent(new CustomEvent("chainward:license-requested"));
      notify({ title: "Access request submitted", description: `Reference ${result.reference} is waiting for manual owner review.`, tone: "success" });
      router.refresh();
    } catch (error) {
      notify({ title: "Request not submitted", description: error instanceof Error ? error.message : "The request could not be saved.", tone: "danger" });
    } finally { setSubmitting(false); }
  }

  return <div className="unlock-workspace">
    <header className="unlock-hero">
      <div><p className="eyebrow">Faction-wide Chainward access</p><h1>Put every chain operation in one protected workspace.</h1><p>Choose a term for {factionName ?? "your verified faction"}. Every option unlocks the same complete toolset with no per-member charge.</p></div>
      <span><Sparkles size={21} /><strong>Complete access</strong><small>One faction · all approved members</small></span>
    </header>

    <section className="unlock-lock-notice" aria-label="Locked feature status">
      <span><LockKeyhole size={21} /></span><div><p className="eyebrow">Workspace status · locked</p><h2>Connection verified. Operational features are still protected.</h2><p>Direct URLs, the logo, shortcuts, and saved bookmarks all enforce the same server-side licence check. Active access unlocks the complete faction workspace.</p></div>
      <ul><li><BarChart3 size={14} />Dashboard & analytics</li><li><History size={14} />Live & historic chains</li><li><Users size={14} />Members & faction access</li><li><WalletCards size={14} />Rewards & payouts</li></ul>
    </section>

    <div className="unlock-main-grid">
      <aside className="unlock-benefits">
        <span className="unlock-benefits__icon"><Crown size={23} /></span>
        <p className="eyebrow">Everything included</p>
        <h2>Operate with clarity, not spreadsheets.</h2>
        <p>Chainward keeps verified Torn data and deliberate faction records clearly separated.</p>
        <ul>{licenceBenefits.map((benefit) => <li key={benefit}><Check size={14} />{benefit}</li>)}</ul>
        <footer><ShieldCheck size={15} /><span><strong>Manual approval boundary</strong><small>No automatic claim is made about Torn transfers. Access activates only after owner review.</small></span></footer>
      </aside>

      <section className="unlock-plans">
        <header><div><p className="eyebrow">Select a term</p><h2>Simple faction pricing</h2><p>Published prices are paid as Torn items—not real money.</p></div><InfoTip label="About faction pricing">Each licence applies to one connected Torn faction and is not priced per user.</InfoTip></header>
        <div className="licence-tier-list licence-tier-list--page" role="radiogroup" aria-label="Faction access plans">
          {licensePlans.map((plan) => {
            const active = plan.id === selectedPlan;
            return <button key={plan.id} role="radio" aria-checked={active} className={`licence-tier-card${active ? " licence-tier-card--selected" : ""}`} onClick={() => setSelectedPlan(plan.id)}>
              {"badge" in plan && <em className={`licence-tier-card__ribbon${plan.id === "quarterly" ? " licence-tier-card__ribbon--popular" : ""}`}>{plan.badge}</em>}
              <span className="licence-tier-card__selector">{active && <Check size={14} />}</span>
              <span className="licence-tier-card__identity"><strong>{plan.name}</strong><small>{plan.term}</small></span>
              <span className="licence-tier-card__description"><strong>{plan.detail}</strong><small><Check size={11} />Analytics, rewards, payouts, and member access</small></span>
              <span className="licence-tier-card__price"><strong>{plan.itemQuantity}</strong><small>{plan.itemName}</small></span>
            </button>;
          })}
        </div>
      </section>
    </div>

    <section className="unlock-reservation">
      <header><div><p className="eyebrow">Ready to reserve</p><h2>{selected.name} access</h2><p>{selected.price} for {selected.term.toLowerCase()} of complete faction-wide access.</p></div><strong>{selected.price}</strong></header>
      <div className="unlock-reservation__reference"><span><Fingerprint size={17} /></span><div><small>Unique payment reference</small><code>{reference ?? "Connect a verified faction to generate a reference"}</code></div><button disabled={!reference} onClick={() => void copyReference()}>{copied ? <CircleCheckBig size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy reference"}</button></div>
      {/* The reference is the only thing tying a Torn transfer to this faction,
          so it is worth saying plainly that it should not be shared. */}
      <p className="unlock-reference-notice">
        <ShieldAlert size={15} />
        <span><strong>Keep this reference to yourself.</strong> It is the single identifier that links your Torn transfer to this faction&apos;s access. Share it only inside the transfer itself — anyone who quotes it could claim your payment during review.</span>
      </p>
      <ol><li><span>1</span><p><strong>Reserve the request</strong><small>The plan and reference are locked to this faction.</small></p></li><li><span>2</span><p><strong>Send {selected.price}</strong><small>Transfer to <TornUserName name={licensePayment.recipientName} tornUserId={licensePayment.recipientTornId} /> with the exact reference.</small></p></li><li><span>3</span><p><strong>Follow owner review</strong><small>This page becomes the live approval-status view.</small></p></li></ol>
      <footer><a href={licensePayment.profileUrl} target="_blank" rel="noreferrer">Open Skillerious profile <ExternalLink size={13} /></a><button className="button button--primary" disabled={!factionId || submitting} onClick={() => void submitRequest()}>{submitting ? "Reserving request…" : `Reserve ${selected.name} access`}<ArrowRight size={15} /></button></footer>
    </section>
  </div>;
}

function PendingAccess({ access, factionName }: { access: FactionAccessSummary; factionName: string | null }) {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    if (!access.reference) return;
    try { await navigator.clipboard.writeText(access.reference); setCopied(true); window.setTimeout(() => setCopied(false), 2_000); }
    catch { notify({ title: "Copy was blocked", description: `Select and copy ${access.reference} manually.`, tone: "warning" }); }
  }
  return <div className="unlock-workspace unlock-state-page">
    <header className="unlock-state-hero unlock-state-hero--pending"><span><Clock3 size={25} /></span><div><p className="eyebrow">Manual owner review · workspace locked</p><h1>{access.label}</h1><p>{factionName ?? "Your faction"} has one stored request. Operational features remain locked until approval, and a duplicate request cannot be created while this review is open.</p></div></header>
    {access.message && <section className="unlock-review-message"><MessageCircleQuestion size={18} /><div><strong>Information requested by Skillerious</strong><p>{access.message}</p></div></section>}
    <section className="unlock-status-card"><header><div><small>Reserved plan</small><strong>{access.plan ?? "Faction access"}</strong></div><span>Submitted {access.startedAt ? new Date(access.startedAt).toLocaleString("en-GB") : "recently"}</span></header><div className="unlock-status-reference"><Fingerprint size={18} /><p><small>Payment reference</small><code>{access.reference ?? "Unavailable"}</code></p><button disabled={!access.reference} onClick={() => void copy()}>{copied ? <CircleCheckBig size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}</button></div><ol><li className="unlock-status-step--done"><span><Check size={14} /></span><p><strong>Request stored</strong><small>Faction, term, purchaser, and reference are reserved.</small></p></li><li><span>2</span><p><strong>Send {access.payment ?? "the displayed items"}</strong><small>Transfer to Skillerious with the exact reference.</small></p></li><li><span>3</span><p><strong>Owner verification</strong><small>The protected access state appears here after approval.</small></p></li></ol><footer><a className="button button--secondary" href={licensePayment.profileUrl} target="_blank" rel="noreferrer">Open Skillerious profile <ExternalLink size={13} /></a></footer></section>
  </div>;
}

function ActiveAccess({ access, factionName }: { access: FactionAccessSummary; factionName: string | null }) {
  const futureCoverage = access.expiresAt
    ? "While this licence remains active, every new Chainward feature released during that term is added automatically with no extra in-game charge."
    : "Your lifetime access grows with Chainward. Every new feature released while the service remains actively maintained and moderated is added automatically with no extra in-game charge.";
  return <div className="unlock-workspace unlock-state-page">
    <header className="unlock-state-hero unlock-state-hero--active"><span><Crown size={25} /><ShieldCheck size={13} /></span><div><p className="eyebrow">Protected faction workspace</p><h1>{access.label}</h1><p>{factionName ?? "This faction"} has complete Chainward operations access.</p></div><em><Check size={14} />Active</em></header>
    <section className="unlock-active-grid"><article><small>Licence reference</small><strong title={access.reference ?? undefined}>{access.reference ?? "Unavailable"}</strong></article><article><small>Activated</small><strong>{access.startedAt ? new Date(access.startedAt).toLocaleDateString("en-GB") : "Unavailable"}</strong></article><article><small>Access end</small><strong>{access.expiresAt ? new Date(access.expiresAt).toLocaleDateString("en-GB") : "No expiry"}</strong></article><article><small>Scope</small><strong>One verified faction</strong></article></section>
    <section className="unlock-included-panel"><div><p className="eyebrow">Included capabilities</p><h2>Everything your faction needs to operate.</h2><p>Your access covers the complete Chainward feature set—not a reduced or per-seat edition.</p></div><ul>{licenceBenefits.map((benefit) => <li key={benefit}><Check size={14} />{benefit}</li>)}</ul><footer><span><Gem size={18} /></span><p><strong>Future releases are covered</strong><small>{futureCoverage}</small></p><em><Sparkles size={12} />Always included</em></footer></section>
  </div>;
}
