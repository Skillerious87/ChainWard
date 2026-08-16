import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayoutCorrections } from "./payout-corrections";

describe("PayoutCorrections", () => {
  it("keeps correction value, reason, operator, and chain together", () => {
    const html = renderToStaticMarkup(<PayoutCorrections corrections={[{
      id: "correction-1",
      chainId: 7000003,
      reason: "Duplicate acknowledgement",
      totalAmount: 12,
      rewardUnit: "Xanax",
      revertedAt: "2026-08-10T12:00:00.000Z",
      revertedByName: "Reviewer",
    }]} />);

    expect(html).toContain("Chain #7000003");
    expect(html).toContain("12 Xanax");
    expect(html).toContain("Duplicate acknowledgement");
    expect(html).toContain("Withdrawn by");
    expect(html).toContain("Reviewer");
    expect(html).toContain("Export corrections (1)");
  });
});
