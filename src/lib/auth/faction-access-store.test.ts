import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalDatabase } from "@/lib/data/local-database";
import { getFactionAccessWorkspace, revokeFactionAccess, setFactionAccess, setFactionAccessBatch } from "./faction-access-store";

describe.sequential("faction access store", () => {
  const originalPath = process.env.CHAINWARD_LOCAL_DB_PATH;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let directory: string | null = null;

  afterEach(() => {
    if (originalPath === undefined) delete process.env.CHAINWARD_LOCAL_DB_PATH;
    else process.env.CHAINWARD_LOCAL_DB_PATH = originalPath;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = null;
  });

  it("persists, updates, audits, and revokes local access", async () => {
    directory = mkdtempSync(path.join(tmpdir(), "chainward-access-"));
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(directory, "access.sqlite");
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
});
