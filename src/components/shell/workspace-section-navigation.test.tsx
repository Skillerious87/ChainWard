import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  WorkspaceSectionNavigation,
  WorkspaceSectionNavigationProvider,
} from "./workspace-section-navigation";

function renderNavigation(pathname: string): string {
  return renderToStaticMarkup(
    <WorkspaceSectionNavigationProvider pathname={pathname}>
      <WorkspaceSectionNavigation pathname={pathname} />
    </WorkspaceSectionNavigationProvider>,
  );
}

describe("WorkspaceSectionNavigation", () => {
  it("groups the chain operation routes and marks the current destination", () => {
    const markup = renderNavigation("/chains/1234");

    expect(markup).toContain('aria-label="Chain operation views"');
    expect(markup).toContain('href="/live-chain"');
    expect(markup).toContain('href="/chain-watch"');
    expect(markup).toContain('href="/analytics"');
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/chains"/);
  });

  it("uses accessible local tabs for member child views", () => {
    const markup = renderNavigation("/members");

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('id="members-tab-overview"');
    expect(markup).toContain('aria-controls="members-panel-roster"');
    expect(markup).toContain('aria-controls="members-panel-patterns"');
    expect(markup).toContain('aria-controls="members-panel-controls"');
  });

  it("connects schemes and every payout child route in one reward bar", () => {
    const markup = renderNavigation("/payouts/recipients");

    expect(markup).toContain('href="/rewards"');
    expect(markup).toContain('href="/payouts"');
    expect(markup).toContain('href="/payouts/ledger"');
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/payouts\/recipients"/);
    expect(markup).toContain('href="/payouts/corrections"');
  });
});
