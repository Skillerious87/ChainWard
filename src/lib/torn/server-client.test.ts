import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  readConnectionSession: vi.fn(),
  readRememberedConnection: vi.fn(),
  updateRememberedConnectionImage: vi.fn(),
  getMyProfileDetails: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("./connection-session", () => ({
  CONNECTION_COOKIE: "temporary",
  readConnectionSession: mocks.readConnectionSession,
}));
vi.mock("./remembered-connection", () => ({
  REMEMBERED_CONNECTION_COOKIE: "remembered",
  readRememberedConnection: mocks.readRememberedConnection,
  updateRememberedConnectionImage: mocks.updateRememberedConnectionImage,
}));
vi.mock("./client", () => ({
  TornClient: class {
    getMyProfileDetails = mocks.getMyProfileDetails;
  },
}));

import { getConfiguredTornConnection } from "./server-client";

const oldImage = "https://profileimages.torn.com/old.gif";
const newImage = "https://profileimages.torn.com/current.gif?v=2";
const session = {
  apiKey: "profile-session-test",
  tornUserId: 123456,
  tornUserName: "Verified member",
  tornUserImageUrl: oldImage as string | null,
  factionId: 51393,
  factionName: "Verified faction",
  factionTag: "VF",
};

async function getRefreshedConnection() {
  const connection = await getConfiguredTornConnection();
  if (!connection) return null;
  return { ...connection, tornUserImageUrl: await connection.refreshProfileImage() };
}

describe("configured connection profile image", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.cookies.mockResolvedValue(new Map([["remembered", { value: "remembered-token" }]]));
    mocks.readRememberedConnection.mockResolvedValue({ ...session });
    mocks.updateRememberedConnectionImage.mockResolvedValue(undefined);
    mocks.getMyProfileDetails.mockResolvedValue({ profile: { id: session.tornUserId, name: session.tornUserName, image: newImage } });
  });

  it("resolves connections without requesting the display-only profile", async () => {
    mocks.getMyProfileDetails.mockRejectedValue(new Error("Torn profile unavailable"));

    await expect(getConfiguredTornConnection()).resolves.toMatchObject({ tornUserImageUrl: oldImage });
    expect(mocks.getMyProfileDetails).not.toHaveBeenCalled();
  });

  it("shares the profile refresh for callers using the same connection", async () => {
    const connection = await getConfiguredTornConnection();
    await Promise.all([connection!.refreshProfileImage(), connection!.refreshProfileImage()]);
    expect(mocks.getMyProfileDetails).toHaveBeenCalledOnce();
    expect(mocks.updateRememberedConnectionImage).toHaveBeenCalledOnce();
  });

  it("recovers a missing remembered image and saves it before returning", async () => {
    mocks.readRememberedConnection.mockResolvedValue({ ...session, tornUserImageUrl: null });
    let finishSave!: () => void;
    mocks.updateRememberedConnectionImage.mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    let returned = false;
    const connection = getRefreshedConnection().then((value) => { returned = true; return value; });
    await vi.waitFor(() => expect(mocks.updateRememberedConnectionImage).toHaveBeenCalledWith("remembered-token", newImage));
    expect(returned).toBe(false);
    finishSave();

    await expect(connection).resolves.toMatchObject({ tornUserImageUrl: newImage });
    expect(mocks.getMyProfileDetails).toHaveBeenCalledOnce();
  });

  it("replaces an outdated remembered image from the current Torn profile", async () => {
    await expect(getRefreshedConnection()).resolves.toMatchObject({ tornUserImageUrl: newImage });
    expect(mocks.updateRememberedConnectionImage).toHaveBeenCalledWith("remembered-token", newImage);
  });

  it("refreshes an image embedded in a temporary session without a remembered write", async () => {
    mocks.cookies.mockResolvedValue(new Map([["temporary", { value: "temporary-token" }]]));
    mocks.readRememberedConnection.mockResolvedValue(null);
    mocks.readConnectionSession.mockReturnValue({ ...session });

    await expect(getRefreshedConnection()).resolves.toMatchObject({ tornUserImageUrl: newImage });
    expect(mocks.updateRememberedConnectionImage).not.toHaveBeenCalled();
  });

  it("keeps the saved image and identity during a Torn failure", async () => {
    mocks.getMyProfileDetails.mockRejectedValue(new Error("Torn unavailable"));

    await expect(getRefreshedConnection()).resolves.toMatchObject({ tornUserId: session.tornUserId, tornUserImageUrl: oldImage });
    expect(mocks.updateRememberedConnectionImage).not.toHaveBeenCalled();
  });

  it("never replaces the avatar with another player's profile image", async () => {
    mocks.getMyProfileDetails.mockResolvedValue({ profile: { id: 999999, image: newImage } });

    await expect(getRefreshedConnection()).resolves.toMatchObject({ tornUserImageUrl: oldImage });
    expect(mocks.updateRememberedConnectionImage).not.toHaveBeenCalled();
  });

  it("clears a saved image when Torn confirms the player has removed it", async () => {
    mocks.getMyProfileDetails.mockResolvedValue({ profile: { id: session.tornUserId, image: null } });

    await expect(getRefreshedConnection()).resolves.toMatchObject({ tornUserImageUrl: null });
    expect(mocks.updateRememberedConnectionImage).toHaveBeenCalledWith("remembered-token", null);
  });

  it("avoids rewriting unchanged images", async () => {
    mocks.getMyProfileDetails.mockResolvedValue({ profile: { id: session.tornUserId, image: oldImage } });

    await expect(getRefreshedConnection()).resolves.toMatchObject({ tornUserImageUrl: oldImage });
    expect(mocks.updateRememberedConnectionImage).not.toHaveBeenCalled();
  });

  it("still displays the retrieved image if persistence is unavailable", async () => {
    mocks.updateRememberedConnectionImage.mockRejectedValue(new Error("Database unavailable"));

    await expect(getRefreshedConnection()).resolves.toMatchObject({ tornUserImageUrl: newImage });
  });
});
