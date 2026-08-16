import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileMenu } from "./profile-menu";

describe("ProfileMenu", () => {
  it("presents verified identity, grouped workspace controls, and density state", () => {
    const html = renderToStaticMarkup(
      <ProfileMenu
        actor={{ name: "Skillerious", tornUserId: 3_212_954, isPlatformAdmin: true }}
        compact
        ownerAccess
        onClose={() => undefined}
        onDisconnect={() => undefined}
        onOpenAbout={() => undefined}
        onToggleDensity={() => undefined}
      />,
    );

    expect(html).toContain("Verified Torn identity");
    expect(html).toContain("#3212954");
    expect(html).toContain("Owner administration");
    expect(html).toContain("Licensing and service controls");
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Disconnect Torn API");
  });
});
