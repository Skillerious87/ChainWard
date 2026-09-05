import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ValidatedTornConnection } from "./connection-service";
import {
  createRememberedConnection,
  readRememberedConnection,
  revokeRememberedConnection,
  updateRememberedConnectionImage,
} from "./remembered-connection";
import { credentialDatabasePath } from "./credential-database";

describe.sequential("remembered Torn connections", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalDatabasePath = process.env.CHAINWARD_LOCAL_DB_PATH;
  const originalSessionSecret = process.env.SESSION_SECRET;
  const originalAppDataDirectory = process.env.CHAINWARD_APP_DATA_DIR;
  let temporaryDirectory = "";

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "chainward-remembered-"));
    delete process.env.DATABASE_URL;
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(temporaryDirectory, "workspace.sqlite");
    process.env.CHAINWARD_APP_DATA_DIR = path.join(temporaryDirectory, "appdata");
    process.env.SESSION_SECRET = "test-only-stable-remembered-connection-secret";
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalDatabasePath === undefined) delete process.env.CHAINWARD_LOCAL_DB_PATH;
    else process.env.CHAINWARD_LOCAL_DB_PATH = originalDatabasePath;
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
    if (originalAppDataDirectory === undefined) delete process.env.CHAINWARD_APP_DATA_DIR;
    else process.env.CHAINWARD_APP_DATA_DIR = originalAppDataDirectory;
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("keeps the raw key server-side and restores the verified identity from an opaque token", async () => {
    const apiKey = "A1B2C3D4E5F6G7H8";
    const stored = await createRememberedConnection(apiKey, connectionFixture());

    expect(stored.token).not.toContain(apiKey);
    expect(stored.token.length).toBeGreaterThanOrEqual(40);
    expect(stored.token.split(".")).toEqual(["v1", expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), "51393", expect.stringMatching(/^[a-f0-9]{64}$/)]);
    expect(readFileSync(credentialDatabasePath()).includes(Buffer.from(apiKey))).toBe(false);
    expect(() => readFileSync(process.env.CHAINWARD_LOCAL_DB_PATH!)).toThrow();
    await expect(readRememberedConnection(stored.token)).resolves.toMatchObject({
      apiKey,
      tornUserId: 3_212_954,
      tornUserName: "Skillerious",
      tornUserImageUrl: "https://profileimages.torn.com/skillerious.png",
      factionId: 51_393,
      factionName: "Prive Cartel",
      factionTag: "PRIVE",
    });

    await revokeRememberedConnection(stored.token);
    await expect(readRememberedConnection(stored.token)).resolves.toBeNull();
  });

  it("backfills a profile image discovered after the connection was created", async () => {
    const stored = await createRememberedConnection("A1B2C3D4E5F6G7H8", connectionFixture({ imageUrl: null }));
    await expect(readRememberedConnection(stored.token)).resolves.toMatchObject({ tornUserImageUrl: null });

    await updateRememberedConnectionImage(stored.token, "https://profileimages.torn.com/skillerious.png");

    await expect(readRememberedConnection(stored.token)).resolves.toMatchObject({
      tornUserImageUrl: "https://profileimages.torn.com/skillerious.png",
    });

    await updateRememberedConnectionImage(stored.token, null);
    await expect(readRememberedConnection(stored.token)).resolves.toMatchObject({ tornUserImageUrl: null });
  });

  it("rejects malformed browser tokens without opening a session", async () => {
    await expect(readRememberedConnection("short-token")).resolves.toBeNull();
  });

  it("refuses a token whose faction scope has been changed", async () => {
    const stored = await createRememberedConnection("A1B2C3D4E5F6G7H8", connectionFixture());
    const parts = stored.token.split(".");
    parts[2] = "99999";
    await expect(readRememberedConnection(parts.join("."))).resolves.toBeNull();
  });
});

function connectionFixture(overrides: { imageUrl?: string | null } = {}): ValidatedTornConnection {
  const imageUrl = overrides.imageUrl !== undefined ? overrides.imageUrl : "https://profileimages.torn.com/skillerious.png";
  return {
    player: { id: 3_212_954, name: "Skillerious", imageUrl },
    faction: { id: 51_393, name: "Prive Cartel", tag: "PRIVE" },
    key: { accessType: "Limited Access", hasFactionPermission: true, selections: ["basic", "chain", "chains", "chainreport", "members"] },
    capabilities: {
      identity: "verified",
      faction: "verified",
      liveChain: "verified",
      completedChains: "verified",
      members: "verified",
      chainReports: "verified",
    },
    checkedAt: "2026-08-09T12:00:00.000Z",
  };
}
