import { licensePlans, type LicensePlanId } from "./pricing";

/**
 * Marketing-surface economics for the published licence plans.
 *
 * Everything here is derived from `licensePlans` — the single source of truth
 * for what a term costs and how long it lasts — so the home page can never
 * drift from what the workspace actually grants. All figures are pure
 * functions of the plan table: no dates, no randomness, no I/O.
 *
 * The "monthly" plan is the baseline every other term is compared against.
 */

const DAYS_PER_MONTH = 30;

export interface PlanEconomics {
  id: LicensePlanId;
  name: string;
  /** Item currency, e.g. `"Xanax"`. */
  itemName: string;
  /** Whole items charged for the term. */
  itemQuantity: number;
  /** Human term label, e.g. `"90 days"` / `"No expiry"`. */
  term: string;
  /** Coverage length in days; `null` for a permanent licence. */
  durationDays: number | null;
  /** `"5 Xanax"` — the canonical cost label. */
  costLabel: string;
  /**
   * Items per 30 days of coverage, rounded to one decimal. `null` for a
   * permanent licence, which has no finite term to divide by.
   */
  monthlyEquivalent: number | null;
  /**
   * Whole items saved across the whole term versus paying the monthly rate
   * for the same number of days. `null` when there is no saving (the monthly
   * plan itself, or a permanent licence).
   */
  savingVsMonthly: number | null;
  /**
   * How much cheaper each day of coverage is than the monthly plan, as a
   * rounded percentage (0–100). `null` for the monthly plan and permanent
   * licences.
   */
  savingPercent: number | null;
  /**
   * Permanent licence only: how many whole months of the monthly plan cost
   * the same as buying this once. `null` for every finite term.
   */
  breakEvenMonths: number | null;
  /** A finite term that can be renewed. */
  isRecurring: boolean;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Items per day for the baseline monthly plan, or `null` if it is unusable. */
function monthlyRatePerDay(): number | null {
  const monthly = licensePlans.find((plan) => plan.id === "monthly");
  if (!monthly || !monthly.durationDays || monthly.durationDays <= 0) return null;
  if (!Number.isFinite(monthly.itemQuantity) || monthly.itemQuantity <= 0) return null;
  return monthly.itemQuantity / monthly.durationDays;
}

/** Economics for one plan id. Falls back to `quarterly` for an unknown id. */
export function planEconomicsById(id: LicensePlanId): PlanEconomics {
  const plan = licensePlans.find((entry) => entry.id === id) ?? licensePlans[1];
  const baseline = monthlyRatePerDay();
  const costLabel = `${plan.itemQuantity} ${plan.itemName}`;

  if (plan.durationDays === null) {
    const breakEvenMonths =
      baseline && baseline > 0
        ? Math.ceil(plan.itemQuantity / (baseline * DAYS_PER_MONTH))
        : null;
    return {
      id: plan.id,
      name: plan.name,
      itemName: plan.itemName,
      itemQuantity: plan.itemQuantity,
      term: plan.term,
      durationDays: null,
      costLabel,
      monthlyEquivalent: null,
      savingVsMonthly: null,
      savingPercent: null,
      breakEvenMonths,
      isRecurring: false,
    };
  }

  const days = plan.durationDays;
  const perDay = plan.itemQuantity / days;
  const monthlyEquivalent = round1(perDay * DAYS_PER_MONTH);

  let savingVsMonthly: number | null = null;
  let savingPercent: number | null = null;
  if (baseline && baseline > 0 && perDay < baseline) {
    savingVsMonthly = Math.round(baseline * days - plan.itemQuantity);
    if (savingVsMonthly <= 0) savingVsMonthly = null;
    const percent = Math.round((1 - perDay / baseline) * 100);
    savingPercent = percent > 0 ? percent : null;
  }

  return {
    id: plan.id,
    name: plan.name,
    itemName: plan.itemName,
    itemQuantity: plan.itemQuantity,
    term: plan.term,
    durationDays: days,
    costLabel,
    monthlyEquivalent,
    savingVsMonthly,
    savingPercent,
    breakEvenMonths: null,
    isRecurring: true,
  };
}

/** Economics for every published plan, in table order. */
export function describePlanEconomics(): PlanEconomics[] {
  return licensePlans.map((plan) => planEconomicsById(plan.id));
}
