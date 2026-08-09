import { describe, expect, it } from "vitest";
import { createPaymentReference, licensePlans } from "./pricing";

describe("licence identifiers and terms", () => {
  it("creates a faction-scoped payment identifier", () => {
    expect(createPaymentReference(51393)).toMatch(/^CW-51393-[A-Z0-9]{8}$/);
  });

  it("keeps displayed prices aligned with activation durations", () => {
    expect(licensePlans.map((plan) => [plan.id, plan.itemQuantity, plan.durationDays, plan.licenseTerm])).toEqual([
      ["monthly", 2, 30, "MONTHLY"],
      ["quarterly", 5, 90, "QUARTERLY"],
      ["annual", 18, 365, "YEARLY"],
      ["lifetime", 60, null, "PERMANENT"],
    ]);
  });
});
