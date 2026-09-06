import { describe, expect, it } from "vitest";
import { describePlanEconomics, planEconomicsById } from "./plan-economics";
import { licensePlans } from "./pricing";

describe("licence plan economics", () => {
  it("keeps the published price string aligned with the item quantity", () => {
    for (const plan of licensePlans) {
      expect(plan.price).toBe(`${plan.itemQuantity} ${plan.itemName}`);
    }
  });

  it("treats the monthly plan as the zero-saving baseline", () => {
    expect(planEconomicsById("monthly")).toMatchObject({
      monthlyEquivalent: 2,
      savingVsMonthly: null,
      savingPercent: null,
      breakEvenMonths: null,
      isRecurring: true,
    });
  });

  it("derives the quarterly saving from the plan table", () => {
    expect(planEconomicsById("quarterly")).toMatchObject({
      costLabel: "5 Xanax",
      monthlyEquivalent: 1.7,
      savingVsMonthly: 1,
      savingPercent: 17,
      breakEvenMonths: null,
      isRecurring: true,
    });
  });

  it("derives the annual saving from the plan table", () => {
    expect(planEconomicsById("annual")).toMatchObject({
      monthlyEquivalent: 1.5,
      savingVsMonthly: 6,
      savingPercent: 26,
      isRecurring: true,
    });
  });

  it("reports a break-even, not a term rate, for the permanent licence", () => {
    expect(planEconomicsById("lifetime")).toMatchObject({
      durationDays: null,
      monthlyEquivalent: null,
      savingVsMonthly: null,
      savingPercent: null,
      breakEvenMonths: 30,
      isRecurring: false,
    });
  });

  it("describes every plan once, in table order", () => {
    expect(describePlanEconomics().map((plan) => plan.id)).toEqual(
      licensePlans.map((plan) => plan.id),
    );
  });

  it("never shows a non-positive saving", () => {
    for (const plan of describePlanEconomics()) {
      if (plan.savingVsMonthly !== null) expect(plan.savingVsMonthly).toBeGreaterThan(0);
      if (plan.savingPercent !== null) expect(plan.savingPercent).toBeGreaterThan(0);
    }
  });

  it("falls back to a known plan for an unrecognised id", () => {
    expect(planEconomicsById("legacy" as never).id).toBe("quarterly");
  });
});
