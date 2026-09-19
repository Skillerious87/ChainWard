import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageLoadingCore } from "./page-loading-core";
import { ViewLoading } from "./view-loading";
import { WorkspaceLoadingScreen } from "./workspace-loading-screen";

describe("page loading experience", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the modern circular loader with accessible route context", () => {
    const html = renderToStaticMarkup(<PageLoadingCore title="Loading roster" hint="Fetching verified faction members" />);
    expect(html).toContain("page-loading-core__ring");
    expect(html).toContain("page-loading-core__chip");
    expect(html).toContain("android-chrome-192x192.png");
    expect(html).toContain('aria-label="Loading roster. Fetching verified faction members."');
    expect(html).toContain("Fetching verified faction members</small>");
  });

  it("renders the isometric cube loader instead, inside the Capacitor Android shell", () => {
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
    const html = renderToStaticMarkup(<PageLoadingCore title="Loading roster" hint="Fetching verified faction members" />);
    expect(html).toContain("iso-loader3d");
    // Three independently-animating cube slots, not a single static shape -
    // this is the specific thing that broke last time (see polish.css).
    expect(html.match(/iso-cube-slot/g)).toHaveLength(3);
    expect(html).toContain("iso-cube-shadow");
    // Never nested inside page-loading-core__mark - that class's fixed
    // 72x72px box (sized for the ring+chip) is what silently broke centering.
    expect(html).not.toContain("page-loading-core__mark");
    expect(html).not.toContain("page-loading-core__ring");
    expect(html).not.toContain("android-chrome-192x192.png");
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
