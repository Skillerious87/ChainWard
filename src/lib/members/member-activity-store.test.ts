import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalDatabase } from "@/lib/data/local-database";
import { getMemberActivityWorkspace, setMemberActivity, setMemberActivityPolicy } from "./member-activity-store";

describe.sequential("member activity store", () => {
  const originalPath = process.env.CHAINWARD_LOCAL_DB_PATH;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let directory: string | null = null;

  afterEach(() => {
    if (originalPath === undefined) delete process.env.CHAINWARD_LOCAL_DB_PATH; else process.env.CHAINWARD_LOCAL_DB_PATH = originalPath;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = null;
  });

  it("persists holiday, watch, clear, and audit changes", async () => {
    directory = mkdtempSync(path.join(tmpdir(), "chainward-activity-"));
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(directory, "activity.sqlite");
    delete process.env.DATABASE_URL;
    createLocalDatabase();
    const faction = { id: 51393, name: "Prive Cartel", tag: "PC" };
    const member = { tornUserId: 123, memberName: "Member" };
    const actor = { tornUserId: 3212954, name: "Skillerious", isPlatformAdmin: true };

    await setMemberActivity(faction, member, actor, { state: "HOLIDAY", holidayUntil: "2026-09-01T00:00:00.000Z", note: "Planned break" });
    let workspace = await getMemberActivityWorkspace(faction.id);
    expect(workspace.records).toEqual([expect.objectContaining({ tornUserId: 123, state: "HOLIDAY", note: "Planned break" })]);

    await setMemberActivity(faction, member, actor, { state: "WATCH", holidayUntil: null, note: "Check activity" });
    await setMemberActivity(faction, member, actor, { state: "STANDARD", holidayUntil: null, note: "Returned" });
    workspace = await getMemberActivityWorkspace(faction.id);
    expect(workspace.records).toEqual([]);
    expect(workspace.audit.map((event) => event.action)).toEqual(["CLEARED", "UPDATED", "HOLIDAY_SET"]);

    await setMemberActivityPolicy(faction, actor, 7);
    workspace = await getMemberActivityWorkspace(faction.id);
    expect(workspace.policy).toMatchObject({ thresholdDays: 7, updatedByTornId: 3212954, updatedByName: "Skillerious" });
    expect(workspace.audit[0]).toMatchObject({ action: "UPDATED", tornUserId: 0, memberName: "Faction activity policy", note: "Inactivity alert threshold changed to 7 days." });
  });
});
