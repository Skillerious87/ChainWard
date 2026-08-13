import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageLoadingCore } from "./page-loading-core";
import { ViewLoading } from "./view-loading";

describe("page loading experience", () => {
  it("renders the modern circular loader with accessible route context", () => {
    const html = renderToStaticMarkup(<PageLoadingCore title="Loading roster" hint="Fetching verified faction members" />);
    expect(html).toContain("page-loading-core__arc--primary");
    expect(html).not.toContain("page-loading-core__arc--secondary");
    expect(html).toContain('aria-label="Loading roster. Fetching verified faction members."');
    expect(html).not.toContain("Fetching verified faction members</small>");
  });

  it("centres the shared core over the incoming page structure", () => {
    const html = renderToStaticMarkup(<ViewLoading variant="table" title="Loading roster" hint="Fetching verified faction members" />);
    expect(html).toContain("view-loading__surface");
    expect(html).toContain("view-loading__centre");
    expect(html).toContain("page-loading-core");
  });
});
