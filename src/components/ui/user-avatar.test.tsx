import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UserAvatar } from "./user-avatar";

describe("UserAvatar", () => {
  it("uses the generated default when the API has no profile image", () => {
    const html = renderToStaticMarkup(<UserAvatar imageUrl={null} name="No photo" size={30} />);

    expect(html).toContain("/images/default-profile-avatar.webp");
    expect(html).toContain("No photo profile picture");
  });
});
