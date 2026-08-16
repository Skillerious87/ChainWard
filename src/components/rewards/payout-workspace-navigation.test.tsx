import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayoutWorkspaceNavigation } from "./payout-workspace-navigation";

describe("PayoutWorkspaceNavigation", () => {
  it("links every ledger child view and adjacent payout route", () => {
    const html = renderToStaticMarkup(<PayoutWorkspaceNavigation registerCount={48} recipientCount={12} correctionCount={2} />);

    expect(html).toContain('href="/payouts"');
    expect(html).toContain('href="/payouts/ledger"');
    expect(html).toContain('href="/payouts/recipients"');
    expect(html).toContain('href="/payouts/corrections"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(">48<");
    expect(html).toContain(">12<");
    expect(html).toContain(">2<");
    expect(html).toContain('href="/chains"');
    expect(html).toContain('href="/rewards"');
  });
});
