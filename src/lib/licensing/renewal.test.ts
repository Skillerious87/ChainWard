import { describe, expect, it } from "vitest";
import { getLicenseRenewalNotice, renewalExpiry } from "./renewal";

describe("licence renewal intelligence", () => {
  const now = new Date("2026-08-26T12:00:00.000Z");

  it("opens renewal at seven days and escalates toward expiry", () => {
    expect(getLicenseRenewalNotice("2026-09-02T12:00:00.000Z", now)).toMatchObject({ phase: "notice", renewalOpen: true, daysRemaining: 7 });
    expect(getLicenseRenewalNotice("2026-08-29T12:00:00.000Z", now)).toMatchObject({ phase: "urgent", renewalOpen: true, daysRemaining: 3 });
    expect(getLicenseRenewalNotice("2026-08-27T06:00:00.000Z", now)).toMatchObject({ phase: "final-day", renewalOpen: true, daysRemaining: 1 });
  });

  it("keeps early and permanent licences out of renewal", () => {
    expect(getLicenseRenewalNotice("2026-09-03T12:00:01.000Z", now).renewalOpen).toBe(false);
    expect(getLicenseRenewalNotice(null, now)).toMatchObject({ phase: "permanent", renewalOpen: false });
  });

  it("adds renewed time after the paid-through date without losing coverage", () => {
    expect(renewalExpiry(new Date("2026-09-01T12:00:00.000Z"), 30, now)?.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(renewalExpiry(new Date("2026-08-20T12:00:00.000Z"), 30, now)?.toISOString()).toBe("2026-09-25T12:00:00.000Z");
    expect(renewalExpiry(new Date("2026-09-01T12:00:00.000Z"), null, now)).toBeNull();
  });
});
