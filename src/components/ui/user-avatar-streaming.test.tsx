// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { UserAvatar } from "./user-avatar";

it("keeps page content and the saved avatar visible until a display refresh resolves", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  let finish!: (url: string | null) => void;
  const imageUrlPromise = new Promise<string | null>((resolve) => { finish = resolve; });
  try {
    await act(async () => root.render(<><p>Workspace ready</p><UserAvatar name="Member" size={30} imageUrl="https://profileimages.torn.com/old.gif" imageUrlPromise={imageUrlPromise} /></>));
    expect(container.textContent).toContain("Workspace ready");
    expect(container.querySelector("img")?.src).toBe("https://profileimages.torn.com/old.gif");
    await act(async () => finish(null));
    expect(container.textContent).toContain("Workspace ready");
    expect(new URL(container.querySelector("img")!.src).pathname).toBe("/images/default-profile-avatar.webp");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
