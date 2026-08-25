import { describe, expect, it, vi } from "vitest";
import { enterConnectedWorkspace } from "./workspace-navigation";

describe("connected workspace navigation", () => {
  it("uses a fresh document request instead of the client router cache", () => {
    const replaceDocument = vi.fn();

    enterConnectedWorkspace("/dashboard", replaceDocument);

    expect(replaceDocument).toHaveBeenCalledOnce();
    expect(replaceDocument).toHaveBeenCalledWith("/dashboard");
  });
});
