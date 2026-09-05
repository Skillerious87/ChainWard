import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UserAvatar } from "./user-avatar";

describe("UserAvatar", () => {
  it("loads a Torn profile image directly and preserves animated image URLs", () => {
    const imageUrl = "https://profileimages.torn.com/player.gif?v=2";
    const html = renderToStaticMarkup(<UserAvatar imageUrl={imageUrl} name="Player" size={30} />);

    expect(html).toContain(`src="${imageUrl}"`);
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("/images/default-profile-avatar.webp");
    expect(html).not.toContain("/_next/image");
  });

  it("uses the generated default when the API has no profile image", () => {
    const html = renderToStaticMarkup(<UserAvatar imageUrl={null} name="No photo" size={30} />);

    expect(html).toContain("/images/default-profile-avatar.webp");
    expect(html).toContain("No photo profile picture");
  });
});
