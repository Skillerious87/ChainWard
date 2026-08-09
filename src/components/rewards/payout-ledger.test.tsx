import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayoutLedger } from "./payout-ledger";

describe("PayoutLedger", () => {
  it("renders a structured payout recorder identity without passing the object to React", () => {
    const html = renderToStaticMarkup(<PayoutLedger entries={[{ id: "entry-1", chainId: 123, tornUserId: 456, memberName: "Member", amount: 5, rewardUnit: "Xanax", tierLabel: "Gold", status: "PAID", processedAt: "2026-08-09T12:00:00.000Z", processedBy: { tornUserId: 3212954, name: "Skillerious" } }]} message="Ready" />);
    expect(html).toContain("Skillerious");
    expect(html).toContain("Torn user ID 3212954");
    expect(html).not.toContain("[object Object]");
  });
});
