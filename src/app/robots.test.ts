import { describe, expect, it } from "vitest";
import robots from "./robots";

describe("robots metadata", () => {
  it("keeps public entry points crawlable and operational routes private", () => {
    const rules = robots().rules;
    expect(rules).toEqual([expect.objectContaining({
      userAgent: "*",
      allow: ["/", "/connect"],
      disallow: expect.arrayContaining(["/api/", "/dashboard", "/members", "/payouts", "/settings"]),
    })]);
  });
});
