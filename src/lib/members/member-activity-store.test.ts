import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalDatabase } from "@/lib/data/local-database";
import { getMemberActivityWorkspace, setMemberActivity, setMemberActivityPolicy, synchronizeMemberInactivityPeriods } from "./member-activity-store";

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
    const faction = { id: 51394, name: "Prive Cartel", tag: "PC" };
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

  it("persists and closes inferred inactivity periods without duplicates", async () => {
    directory = mkdtempSync(path.join(tmpdir(), "chainward-inactivity-"));
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(directory, "activity.sqlite");
    delete process.env.DATABASE_URL;
    createLocalDatabase();
    const faction = { id: 51393, name: "Prive Cartel", tag: "PC" };
    const checkedAtSeconds = Date.parse("2026-09-02T12:00:00.000Z") / 1_000;
    const member = { tornId: 123, name: "Member", position: "Member", level: 50, daysInFaction: 100, lastAction: "2 days ago", lastActionAt: checkedAtSeconds - 2 * 86_400, status: "Okay", statusDescription: "", statusUntil: null };

    let periods = await synchronizeMemberInactivityPeriods(faction, [member], [], "2026-09-02T12:00:00.000Z");
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ tornUserId: 123, endedAt: null, peakDurationSeconds: 2 * 86_400 });

    periods = await synchronizeMemberInactivityPeriods(faction, [member], [], "2026-09-02T13:00:00.000Z");
    expect(periods).toHaveLength(1);
    expect(periods[0]?.peakDurationSeconds).toBe(2 * 86_400 + 3_600);

    periods = await synchronizeMemberInactivityPeriods(faction, [{ ...member, lastAction: "Just now", lastActionAt: checkedAtSeconds + 7_200 }], [], "2026-09-02T14:00:00.000Z");
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ endedAt: "2026-09-02T14:00:00.000Z", peakDurationSeconds: 2 * 86_400 + 7_200 });

    const workspace = await getMemberActivityWorkspace(faction.id);
    expect(workspace.inactivityPeriods).toEqual(periods);
  });
});
