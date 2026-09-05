import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConfiguredTornConnection } = vi.hoisted(() => ({ getConfiguredTornConnection: vi.fn() }));

vi.mock("@/lib/torn/server-client", () => ({ getConfiguredTornConnection }));

import { getCurrentActor, getCurrentActorWithProfileImage } from "./current-actor";

describe("current actor", () => {
  beforeEach(() => {
    getConfiguredTornConnection.mockReset();
  });

  it("uses the server-trusted session identity and image without another Torn request", async () => {
    const getMyProfile = vi.fn();
    const getMyProfileDetails = vi.fn();
    getConfiguredTornConnection.mockResolvedValue({
      tornUserId: 123_456,
      tornUserName: "Verified member",
      tornUserImageUrl: "https://profileimages.torn.com/profile-123456.png?v=1",
      factionId: 51_393,
      factionName: "Verified faction",
      factionTag: "VF",
      client: { getMyProfile, getMyProfileDetails },
    });

    await expect(getCurrentActor()).resolves.toEqual({
      name: "Verified member",
      tornUserId: 123_456,
      isPlatformAdmin: false,
      profileImageUrl: "https://profileimages.torn.com/profile-123456.png?v=1",
    });
    expect(getMyProfile).not.toHaveBeenCalled();
    expect(getMyProfileDetails).not.toHaveBeenCalled();
  });

  it("refreshes the avatar only for the rendered shell, leaving authorization independent", async () => {
    const refreshProfileImage = vi.fn().mockResolvedValue("https://profileimages.torn.com/current.gif");
    getConfiguredTornConnection.mockResolvedValue({
      tornUserId: 123456,
      tornUserName: "Verified member",
      tornUserImageUrl: "https://profileimages.torn.com/old.gif",
      refreshProfileImage,
    });

    await expect(getCurrentActor()).resolves.toMatchObject({ tornUserId: 123456 });
    expect(refreshProfileImage).not.toHaveBeenCalled();
    await expect(getCurrentActorWithProfileImage()).resolves.toMatchObject({
      tornUserId: 123456,
      profileImageUrl: "https://profileimages.torn.com/current.gif",
    });
    expect(refreshProfileImage).toHaveBeenCalledOnce();
  });

  it("uses the default after a confirmed image removal even when the actor has a saved URL", async () => {
    getConfiguredTornConnection.mockResolvedValue({
      tornUserId: 123456,
      tornUserName: "Verified member",
      tornUserImageUrl: "https://profileimages.torn.com/old.gif",
      refreshProfileImage: vi.fn().mockResolvedValue(null),
    });

    await expect(getCurrentActorWithProfileImage()).resolves.toMatchObject({ profileImageUrl: null });
  });

  it("keeps the trusted identity when the connection resolved no profile image", async () => {
    const getMyProfile = vi.fn();
    const getMyProfileDetails = vi.fn().mockResolvedValue({
      profile: { id: 123_456, name: "Verified member", image: null },
    });
    getConfiguredTornConnection.mockResolvedValue({
      tornUserId: 123_456,
      tornUserName: "Verified member",
      tornUserImageUrl: null,
      factionId: 51_393,
      factionName: "Verified faction",
      factionTag: "VF",
      client: { getMyProfile, getMyProfileDetails },
    });

    await expect(getCurrentActor()).resolves.toMatchObject({
      name: "Verified member",
      tornUserId: 123_456,
      profileImageUrl: null,
    });
    expect(getMyProfile).not.toHaveBeenCalled();
    expect(getMyProfileDetails).not.toHaveBeenCalled();
  });

  it("recovers a legacy session identity and image from the full profile", async () => {
    const getMyProfile = vi.fn();
    const getMyProfileDetails = vi.fn().mockResolvedValue({
      profile: {
        id: 123_456,
        name: "Recovered member",
        image: "https://profileimages.torn.com/recovered.gif",
      },
    });
    getConfiguredTornConnection.mockResolvedValue({
      tornUserId: 123_456,
      tornUserName: null,
      tornUserImageUrl: null,
      factionId: 51_393,
      factionName: null,
      factionTag: null,
      client: { getMyProfile, getMyProfileDetails },
    });

    await expect(getCurrentActor()).resolves.toMatchObject({
      name: "Recovered member",
      tornUserId: 123_456,
      profileImageUrl: "https://profileimages.torn.com/recovered.gif",
    });
    expect(getMyProfile).not.toHaveBeenCalled();
    expect(getMyProfileDetails).toHaveBeenCalledOnce();
  });
});
