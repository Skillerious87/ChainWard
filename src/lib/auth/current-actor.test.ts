import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConfiguredTornConnection } = vi.hoisted(() => ({ getConfiguredTornConnection: vi.fn() }));

vi.mock("@/lib/torn/server-client", () => ({ getConfiguredTornConnection }));

import { getCurrentActor } from "./current-actor";

describe("current actor", () => {
  beforeEach(() => {
    getConfiguredTornConnection.mockReset();
  });

  it("uses the server-trusted session identity without another Torn request", async () => {
    const getMyProfile = vi.fn();
    getConfiguredTornConnection.mockResolvedValue({
      tornUserId: 123_456,
      tornUserName: "Verified member",
      factionId: 51_393,
      factionName: "Verified faction",
      factionTag: "VF",
      client: { getMyProfile },
    });

    await expect(getCurrentActor()).resolves.toEqual({
      name: "Verified member",
      tornUserId: 123_456,
      isPlatformAdmin: false,
    });
    expect(getMyProfile).not.toHaveBeenCalled();
  });
});
