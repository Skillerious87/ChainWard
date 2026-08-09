import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ValidatedTornConnection } from "./connection-service";
import {
  createRememberedConnection,
  readRememberedConnection,
  revokeRememberedConnection,
} from "./remembered-connection";

describe.sequential("remembered Torn connections", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalDatabasePath = process.env.CHAINWARD_LOCAL_DB_PATH;
  const originalSessionSecret = process.env.SESSION_SECRET;
  let temporaryDirectory = "";

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "chainward-remembered-"));
    delete process.env.DATABASE_URL;
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(temporaryDirectory, "workspace.sqlite");
    process.env.SESSION_SECRET = "test-only-stable-remembered-connection-secret";
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalDatabasePath === undefined) delete process.env.CHAINWARD_LOCAL_DB_PATH;
    else process.env.CHAINWARD_LOCAL_DB_PATH = originalDatabasePath;
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("keeps the raw key server-side and restores the verified identity from an opaque token", async () => {
    const apiKey = "A1B2C3D4E5F6G7H8";
    const stored = await createRememberedConnection(apiKey, connectionFixture());

    expect(stored.token).not.toContain(apiKey);
    expect(stored.token.length).toBeGreaterThanOrEqual(40);
    expect(readFileSync(process.env.CHAINWARD_LOCAL_DB_PATH!).includes(Buffer.from(apiKey))).toBe(false);
    await expect(readRememberedConnection(stored.token)).resolves.toMatchObject({
      apiKey,
      tornUserId: 3_212_954,
      factionId: 51_393,
    });

    await revokeRememberedConnection(stored.token);
    await expect(readRememberedConnection(stored.token)).resolves.toBeNull();
  });

  it("rejects malformed browser tokens without opening a session", async () => {
    await expect(readRememberedConnection("short-token")).resolves.toBeNull();
  });
});

function connectionFixture(): ValidatedTornConnection {
  return {
    player: { id: 3_212_954, name: "Skillerious" },
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
