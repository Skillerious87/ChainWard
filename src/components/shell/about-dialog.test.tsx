import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLATFORM_OWNER } from "@/lib/auth/platform-owner";
import { AboutDialog, CHAINWARD_VERSION } from "./about-dialog";

describe("AboutDialog", () => {
  it("presents compact, accessible application information", () => {
    const html = renderToStaticMarkup(<AboutDialog open onClose={() => undefined} />);
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1];

    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`<h2 id="${labelledBy}">Chainward</h2>`);
    expect(html).toContain(`<p id="${describedBy}">`);
    expect(html).toContain(`>${CHAINWARD_VERSION}</dd>`);
    expect(html).toContain("Web app");
    expect(html).toContain("Torn API");
    expect(html).toContain("Restricted API access. Not affiliated with Torn.");
    expect(html).not.toContain("dialog__actions");
  });

  it("links the creator identity to the configured Torn profile", () => {
    const html = renderToStaticMarkup(<AboutDialog open onClose={() => undefined} />);

    expect(html).toContain(`href="${PLATFORM_OWNER.profileUrl}"`);
    expect(html).toContain(`View ${PLATFORM_OWNER.name}&#x27;s Torn profile`);
    expect(html).toContain(PLATFORM_OWNER.name);
    expect(html).toContain(`#${PLATFORM_OWNER.tornUserId}`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});
