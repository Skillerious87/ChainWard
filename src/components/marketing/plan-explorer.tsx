"use client";

import {
  ArrowRight,
  CalendarCheck2,
  CalendarDays,
  Check,
  Clock3,
  Crown,
  ExternalLink,
  Fingerprint,
  ShieldCheck,
  TrendingDown,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { licensePayment, licensePlans, type LicensePlanId } from "@/lib/licensing/pricing";
import { planEconomicsById } from "@/lib/licensing/plan-economics";

const PLAN_ICON: Record<LicensePlanId, LucideIcon> = {
  monthly: Clock3,
  quarterly: CalendarDays,
  annual: CalendarCheck2,
  lifetime: Crown,
};

const PLAN_EYEBROW: Record<LicensePlanId, string> = {
  monthly: "Flexible start",
  quarterly: "Most popular",
  annual: "Best recurring value",
  lifetime: "Permanent access",
};

const INCLUDED = [
  "Complete operations workspace",
  "Unlimited approved faction members",
  "Every feature and release in the term",
] as const;

const FEATURED: LicensePlanId = "quarterly";

/** Short, human summary of a plan's economics — safe for any plan shape. */
function rateSummary(id: LicensePlanId): string {
  const economics = planEconomicsById(id);
  if (economics.durationDays === null) {
    return economics.breakEvenMonths
      ? `One payment, no renewal date. It costs the same as ${economics.breakEvenMonths} months on the monthly plan, then never charges again.`
      : "One payment. No renewal date.";
  }
  if (economics.savingPercent === null || economics.monthlyEquivalent === null) {
    return `${economics.costLabel} every ${economics.term}. This is the baseline rate every longer term is measured against.`;
  }
  return `Works out to about ${economics.monthlyEquivalent} ${economics.itemName} a month — ${economics.savingPercent}% below the monthly rate — paid ${economics.costLabel} up front.`;
}

export function PlanExplorer() {
  const [openId, setOpenId] = useState<LicensePlanId | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (openId && !dialog.open) dialog.showModal();
    if (!openId && dialog.open) dialog.close();
  }, [openId]);

  const close = useCallback(() => setOpenId(null), []);

  const economics = openId ? planEconomicsById(openId) : null;
  const openPlan = openId ? licensePlans.find((plan) => plan.id === openId) ?? null : null;

  return (
    <>
      <div className="welcome-pricing__grid">
        {licensePlans.map((plan) => {
          const Icon = PLAN_ICON[plan.id];
          const economicsForCard = planEconomicsById(plan.id);
          const featured = plan.id === FEATURED;
          const saving =
            economicsForCard.savingVsMonthly !== null
              ? `Save ${economicsForCard.savingVsMonthly} ${economicsForCard.itemName}`
              : economicsForCard.breakEvenMonths !== null
                ? "Never renews"
                : null;
          return (
            <button
              type="button"
              key={plan.id}
              className={`welcome-plan${featured ? " welcome-plan--featured" : ""}`}
              aria-haspopup="dialog"
              onClick={() => setOpenId(plan.id)}
            >
              <span className="welcome-plan__head">
                <span className="welcome-plan__icon">
                  <Icon size={16} />
                </span>
                {"badge" in plan && <em>{plan.badge}</em>}
              </span>
              <span className="welcome-plan__eyebrow">{PLAN_EYEBROW[plan.id]}</span>
              <span className="welcome-plan__name">{plan.name}</span>
              <span className="welcome-plan__price">
                <strong>{plan.itemQuantity}</strong> {plan.itemName}
              </span>
              <span className="welcome-plan__term">{plan.term}</span>
              {saving && (
                <span className="welcome-plan__saving">
                  <TrendingDown size={12} /> {saving}
                </span>
              )}
              <span className="welcome-plan__view">
                View details <ArrowRight size={13} />
              </span>
            </button>
          );
        })}
      </div>

      <dialog
        ref={dialogRef}
        className="dialog plan-dialog"
        aria-labelledby="plan-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={close}
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
      >
        {economics && openPlan && (
          <div className="plan-dialog__inner">
            <header className="dialog__header">
              <div>
                <p className="plan-dialog__eyebrow">{PLAN_EYEBROW[economics.id]}</p>
                <h2 id="plan-dialog-title">{economics.name} licence</h2>
                <p>
                  {economics.durationDays === null
                    ? "Permanent access for one connected faction."
                    : `${economics.term} of complete access for one connected faction.`}
                </p>
              </div>
              <button type="button" className="icon-button" onClick={close} aria-label="Close">
                <X size={18} />
              </button>
            </header>

            <div className="dialog__body plan-dialog__body">
              <div className="plan-dialog__cost">
                <strong>{economics.itemQuantity}</strong>
                <span>
                  <b>{economics.itemName}</b>
                  <small>{economics.durationDays === null ? "one payment" : `for ${economics.term}`}</small>
                </span>
                {economics.savingPercent !== null && (
                  <em className="plan-dialog__badge">
                    <TrendingDown size={13} /> {economics.savingPercent}% less per day than monthly
                  </em>
                )}
                {economics.breakEvenMonths !== null && (
                  <em className="plan-dialog__badge">
                    <Check size={13} /> Breaks even at {economics.breakEvenMonths} months
                  </em>
                )}
              </div>

              <p className="plan-dialog__rate">{rateSummary(economics.id)}</p>

              <ul className="plan-dialog__included">
                {INCLUDED.map((item) => (
                  <li key={item}>
                    <Check size={13} /> {item}
                  </li>
                ))}
              </ul>

              <div className="plan-dialog__activation">
                <span>
                  <Fingerprint size={15} />
                </span>
                <p>
                  <strong>Paid in Torn items, activated by hand.</strong>
                  Send{" "}
                  <b>
                    {economics.itemQuantity} {economics.itemName}
                  </b>{" "}
                  to{" "}
                  <a href={licensePayment.profileUrl} target="_blank" rel="noreferrer">
                    {licensePayment.recipientName}
                    <ExternalLink size={11} />
                  </a>{" "}
                  with the unique reference your workspace generates after you connect. Access begins
                  once the platform owner matches and approves the transfer.
                </p>
              </div>

              <p className="plan-dialog__note">
                <ShieldCheck size={13} /> Chainward never claims a transfer happened automatically —
                every activation is a recorded, manual decision.
              </p>
            </div>

            <div className="dialog__actions plan-dialog__actions">
              <button type="button" className="button button--secondary" onClick={close}>
                Close
              </button>
              <Link className="button button--primary" href="/connect">
                Connect your faction <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
