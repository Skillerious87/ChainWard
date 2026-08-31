import { describe, expect, it, vi } from "vitest";
import { enterConnectedWorkspace } from "./workspace-navigation";

describe("connected workspace navigation", () => {
  it("uses a fresh document request instead of the client router cache", () => {
    const replaceDocument = vi.fn();
    let navigate: (() => void) | undefined;
    const scheduleNavigation = vi.fn((scheduledNavigation: () => void) => { navigate = scheduledNavigation; });

    enterConnectedWorkspace("/dashboard", replaceDocument, scheduleNavigation);

    expect(scheduleNavigation).toHaveBeenCalledOnce();
    expect(replaceDocument).not.toHaveBeenCalled();
    navigate?.();
    expect(replaceDocument).toHaveBeenCalledOnce();
    expect(replaceDocument).toHaveBeenCalledWith("/dashboard");
  });
});
