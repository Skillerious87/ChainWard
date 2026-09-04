import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalDatabase } from "@/lib/data/local-database";
import type { ValidatedTornConnection } from "@/lib/torn/connection-service";
import { getFactionAccessWorkspace, registerFactionAccessRequest, revokeFactionAccess, setFactionAccess, setFactionAccessBatch } from "./faction-access-store";

describe.sequential("faction access store", () => {
  const originalPath = process.env.CHAINWARD_LOCAL_DB_PATH;
  const originalAppDataDirectory = process.env.CHAINWARD_APP_DATA_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let directory: string | null = null;

  afterEach(() => {
    if (originalPath === undefined) delete process.env.CHAINWARD_LOCAL_DB_PATH;
    else process.env.CHAINWARD_LOCAL_DB_PATH = originalPath;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalAppDataDirectory === undefined) delete process.env.CHAINWARD_APP_DATA_DIR;
    else process.env.CHAINWARD_APP_DATA_DIR = originalAppDataDirectory;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = null;
  });

  it("persists, updates, audits, and revokes local access", async () => {
    directory = mkdtempSync(path.join(tmpdir(), "chainward-access-"));
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(directory, "access.sqlite");
    process.env.CHAINWARD_APP_DATA_DIR = path.join(directory, "appdata");
    delete process.env.DATABASE_URL;
    createLocalDatabase();
    const faction = { id: 51393, name: "Prive Cartel", tag: "PC" };
    const target = { tornUserId: 123, memberName: "Member" };

    expect(await setFactionAccess(faction, target, 3212954, "VIEWER", "ACTIVE")).toBe(true);
    expect(await setFactionAccess(faction, target, 3212954, "CHAIN_MANAGER", "SUSPENDED")).toBe(true);
    expect(await setFactionAccess(faction, target, 3212954, "CHAIN_MANAGER", "SUSPENDED")).toBe(false);
    let workspace = await getFactionAccessWorkspace(faction.id);
    expect(workspace.assignments).toEqual([expect.objectContaining({ tornUserId: 123, role: "CHAIN_MANAGER", status: "SUSPENDED" })]);
    expect(workspace.audit.map((event) => event.action)).toEqual(["SUSPENDED", "GRANTED"]);

    await revokeFactionAccess(faction, target, 3212954);
    workspace = await getFactionAccessWorkspace(faction.id);
    expect(workspace.assignments).toEqual([]);
    expect(workspace.audit[0]?.action).toBe("REVOKED");
  });

  it("updates multiple local assignments in one operation", async () => {
    directory = mkdtempSync(path.join(tmpdir(), "chainward-access-batch-"));
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(directory, "access.sqlite");
    process.env.CHAINWARD_APP_DATA_DIR = path.join(directory, "appdata");
    delete process.env.DATABASE_URL;
    createLocalDatabase();
    const faction = { id: 51393, name: "Prive Cartel", tag: "PC" };

    const targets = [{ tornUserId: 123, memberName: "First" }, { tornUserId: 456, memberName: "Second" }];
    expect(await setFactionAccessBatch(faction, targets, 3212954, "CHAIN_MANAGER", "ACTIVE")).toBe(2);
    expect(await setFactionAccessBatch(faction, targets, 3212954, "CHAIN_MANAGER", "ACTIVE")).toBe(0);
    const workspace = await getFactionAccessWorkspace(faction.id);

    expect(workspace.assignments).toHaveLength(2);
    expect(workspace.assignments.every((assignment) => assignment.role === "CHAIN_MANAGER" && assignment.status === "ACTIVE")).toBe(true);
    expect(workspace.audit.map((event) => event.action)).toEqual(["GRANTED", "GRANTED"]);
  });

  it("turns an unassigned verified sign-in into an administrator approval request", async () => {
    directory = mkdtempSync(path.join(tmpdir(), "chainward-access-request-"));
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(directory, "access.sqlite");
    process.env.CHAINWARD_APP_DATA_DIR = path.join(directory, "appdata");
    delete process.env.DATABASE_URL;
    createLocalDatabase();
    const connection = connectionFixture();

    await expect(registerFactionAccessRequest(connection)).resolves.toBe(true);
    await expect(registerFactionAccessRequest(connection)).resolves.toBe(false);
    let workspace = await getFactionAccessWorkspace(connection.faction.id);
    expect(workspace.requests).toEqual([expect.objectContaining({ tornUserId: connection.player.id, memberName: connection.player.name })]);

    await setFactionAccess(connection.faction, { tornUserId: connection.player.id, memberName: connection.player.name }, 3_212_954, "VIEWER", "ACTIVE");
    workspace = await getFactionAccessWorkspace(connection.faction.id);
    expect(workspace.requests).toEqual([]);
    expect(workspace.assignments).toEqual([expect.objectContaining({ tornUserId: connection.player.id, role: "VIEWER", status: "ACTIVE" })]);
  });
});

function connectionFixture(): ValidatedTornConnection {
  return {
    player: { id: 123_456, name: "Waiting member", imageUrl: null },
    faction: { id: 51_393, name: "Prive Cartel", tag: "PRIVE" },
    key: { accessType: "Limited Access", hasFactionPermission: true, selections: ["basic", "chain", "chains", "chainreport", "members"] },
    capabilities: { identity: "verified", faction: "verified", liveChain: "verified", completedChains: "verified", members: "verified", chainReports: "verified" },
    checkedAt: "2026-09-03T15:00:00.000Z",
  };
}
