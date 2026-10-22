import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageSpinner } from "./page-spinner";

describe("plain page loading", () => {
  it("renders one accessible spinner without a screen, logo, copy, or skeleton", () => {
    const html = renderToStaticMarkup(<PageSpinner label="Loading roster" />);
    expect(html).toContain('role="status" aria-label="Loading roster"');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).not.toMatch(/<img|<svg|skeleton|overlay|Loading dashboard|animation-delay/);
    expect(html).not.toContain("view-loading");
    expect(html).not.toContain("page-loading-core");
  });

  it("centres the initial document spinner without a fixed overlay", () => {
    const html = renderToStaticMarkup(<PageSpinner label="Loading workspace" fullPage />);
    expect(html).toContain("page-spinner--document");
    expect(html).toContain('aria-label="Loading workspace"');
    expect(html).not.toContain("workspace-loading-screen");
  });
});
