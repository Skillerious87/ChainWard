import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PayoutLedgerEntry } from "@/lib/rewards/payout-store";
import { PayoutRecipients } from "./payout-recipients";

describe("PayoutRecipients", () => {
  it("never combines unlike reward units for the same member", () => {
    const base: Omit<PayoutLedgerEntry, "id" | "amount" | "rewardUnit"> = { chainId: 99, tornUserId: 7, memberName: "Member", tierLabel: "Gold", status: "PAID", createdAt: "2026-08-10T10:00:00.000Z", processedAt: "2026-08-10T11:00:00.000Z", processedBy: { tornUserId: 1, name: "Recorder" } };
    const html = renderToStaticMarkup(<PayoutRecipients entries={[
      { ...base, id: "item", amount: 5, rewardUnit: "Xanax" },
      { ...base, id: "cash", amount: 1_000_000, rewardUnit: "$" },
    ]} />);

    expect(html).toContain("Xanax");
    expect(html).toContain("1,000,000");
    expect(html).not.toContain("1,000,005");
  });

  it("keeps an addressable recipient section when the ledger is empty", () => {
    const html = renderToStaticMarkup(<PayoutRecipients entries={[]} />);

    expect(html).toContain('id="payout-recipients"');
    expect(html).toContain("No recipient totals yet");
  });

  it("does not present zero-reward members as payout recipients", () => {
    const common = { chainId: 99, tierLabel: "Entry", status: "PAID" as const, createdAt: "2026-08-10T10:00:00.000Z", processedAt: "2026-08-10T11:00:00.000Z", processedBy: { tornUserId: 1, name: "Recorder" }, rewardUnit: "Xanax" };
    const html = renderToStaticMarkup(<PayoutRecipients entries={[
      { ...common, id: "eligible", tornUserId: 7, memberName: "Eligible member", amount: 1 },
      { ...common, id: "below-threshold", tornUserId: 8, memberName: "Below threshold member", tierLabel: "Below threshold", amount: 0 },
    ]} />);

    expect(html).toContain("Eligible member");
    expect(html).not.toContain("Below threshold member");
    expect(html).toContain("Recipients</small><strong>1</strong>");
  });
});
