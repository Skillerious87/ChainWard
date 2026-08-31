import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageLoadingCore } from "./page-loading-core";
import { ViewLoading } from "./view-loading";
import { WorkspaceLoadingScreen } from "./workspace-loading-screen";

describe("page loading experience", () => {
  it("renders the modern circular loader with accessible route context", () => {
    const html = renderToStaticMarkup(<PageLoadingCore title="Loading roster" hint="Fetching verified faction members" />);
    expect(html).toContain("page-loading-core__arc--primary");
    expect(html).toContain("page-loading-core__arc--secondary");
    expect(html).toContain("android-chrome-192x192.png");
    expect(html).toContain('aria-label="Loading roster. Fetching verified faction members."');
    expect(html).toContain("Fetching verified faction members</small>");
  });

  it("renders a complete protected document handoff", () => {
    const html = renderToStaticMarkup(<WorkspaceLoadingScreen />);
    expect(html).toContain("workspace-loading-screen");
    expect(html).toContain("Opening secure workspace");
    expect(html).toContain("Secure session handoff");
  });

  it("centres the shared core over the incoming page structure", () => {
    const html = renderToStaticMarkup(<ViewLoading variant="table" title="Loading roster" hint="Fetching verified faction members" />);
    expect(html).toContain("view-loading__surface");
    expect(html).toContain("view-loading__centre");
    expect(html).toContain("page-loading-core");
  });
});
