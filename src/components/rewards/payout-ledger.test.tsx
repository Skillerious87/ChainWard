import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PayoutLedgerEntry } from "@/lib/rewards/payout-store";
import { analysePayoutLedger, PayoutLedger } from "./payout-ledger";

describe("PayoutLedger", () => {
  it("renders a structured payout recorder identity without passing the object to React", () => {
    const html = renderToStaticMarkup(<PayoutLedger entries={[{ id: "entry-1", chainId: 123, tornUserId: 456, memberName: "Member", amount: 5, rewardUnit: "Xanax", tierLabel: "Gold", status: "PAID", createdAt: "2026-08-09T11:00:00.000Z", processedAt: "2026-08-09T12:00:00.000Z", processedBy: { tornUserId: 3212954, name: "Skillerious" } }]} message="Ready" />);
    expect(html).toContain("Skillerious");
    expect(html).toContain("Torn user ID 3212954");
    expect(html).not.toContain("[object Object]");
  });

  it("adds artwork-aware rewards and professional register controls", () => {
    const html = renderToStaticMarkup(<PayoutLedger entries={[
      entry({ id: "none", amount: 0, tornUserId: 1, memberName: "No reward", status: "PAID" }),
      entry({ id: "single", amount: 1, tornUserId: 2, memberName: "Single pill", status: "PAID" }),
      entry({ id: "blister", amount: 3, tornUserId: 3, memberName: "Blister", status: "PAID" }),
      entry({ id: "box", amount: 5, tornUserId: 4, memberName: "Box", status: "PAID" }),
    ]} message="Ready" />);

    expect(html).toContain("/images/rewards/xanax-reward-one-pill.png");
    expect(html).toContain("/images/rewards/xanax-reward.png");
    expect(html).toContain("/images/rewards/xanax-reward-box.png");
    expect(html).toContain("reward-amount--none");
    expect(html).toContain("Export view (4)");
    expect(html).toContain("Last 30 days");
    expect(html).toContain("aria-sort=\"descending\"");
    expect(html).toContain("Open chain 123");
  });

  it("keeps unlike reward units separate while calculating settlement risk", () => {
    const entries: PayoutLedgerEntry[] = [
      entry({ id: "paid", amount: 4, rewardUnit: "Xanax", status: "PAID", processedAt: "2026-08-10T12:00:00.000Z", processedBy: { tornUserId: 1, name: "Recorder" } }),
      entry({ id: "approved", amount: 2, rewardUnit: "Xanax", status: "APPROVED" }),
      entry({ id: "held", amount: 5_000_000, rewardUnit: "$", status: "HELD", tierLabel: null }),
      entry({ id: "waived", amount: 1, rewardUnit: "Xanax", status: "WAIVED" }),
    ];
    const analysis = analysePayoutLedger(entries);

    expect(analysis.settlementRate).toBe(50);
    expect(analysis.held).toBe(1);
    expect(analysis.missingTiers).toBe(1);
    expect(analysis.openTotals.get("Xanax")).toBe(2);
    expect(analysis.openTotals.get("$")).toBe(5_000_000);
  });

  it("presents unresolved share as chain risk instead of resolved progress", () => {
    const settled = renderToStaticMarkup(<PayoutLedger entries={[
      entry({ id: "paid", status: "PAID", processedAt: "2026-08-10T12:00:00.000Z" }),
      entry({ id: "waived", status: "WAIVED" }),
    ]} message="Ready" />);
    expect(settled).toContain("aria-label=\"0 percent unresolved settlement risk\"");
    expect(settled).toContain("0% unresolved risk");

    const exposed = renderToStaticMarkup(<PayoutLedger entries={[
      entry({ id: "paid", status: "PAID", processedAt: "2026-08-10T12:00:00.000Z" }),
      entry({ id: "pending", status: "PENDING" }),
    ]} message="Ready" />);
    expect(exposed).toContain("aria-label=\"50 percent unresolved settlement risk\"");
  });
});

function entry(overrides: Partial<PayoutLedgerEntry>): PayoutLedgerEntry {
  return {
    id: "entry",
    chainId: 123,
    tornUserId: 456,
    memberName: "Member",
    amount: 1,
    rewardUnit: "Xanax",
    tierLabel: "Gold",
    status: "PENDING",
    createdAt: "2026-08-09T11:00:00.000Z",
    processedAt: null,
    processedBy: null,
    ...overrides,
  };
}
