import { describe, expect, it } from "vitest";
import { evaluateLicense } from "./access";

const now = new Date("2026-08-08T12:00:00Z");

describe("licence access", () => {
  it("allows access when licensing is disabled", () => {
    expect(evaluateLicense(null, now, false)).toEqual({ allowed: true });
  });

  it("rejects expired licences even if their stored status is active", () => {
    expect(
      evaluateLicense(
        {
          status: "ACTIVE",
          issuedAt: new Date("2026-01-01T00:00:00Z"),
          expiresAt: new Date("2026-08-01T00:00:00Z"),
        },
        now,
        true,
      ),
    ).toEqual({ allowed: false, reason: "EXPIRED" });
  });

  it("allows permanent active licences", () => {
    expect(
      evaluateLicense(
        { status: "ACTIVE", issuedAt: now, expiresAt: null },
        now,
        true,
      ),
    ).toEqual({ allowed: true });
  });
});
