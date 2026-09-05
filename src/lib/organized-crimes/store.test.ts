import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalDatabase } from "@/lib/data/local-database";
import {
  deleteMemberIntel,
  readMemberIntel,
  readOcReviewSettings,
  readOcSharePreference,
  saveMemberIntel,
  writeOcReviewSettings,
  writeOcSharePreference,
} from "./store";
import type { MemberIntel } from "./types";

const FACTION = { id: 5_150, name: "Test Faction", tag: "TF" };

function intel(tornUserId: number, overrides: Partial<MemberIntel> = {}): MemberIntel {
  return {
    factionId: FACTION.id,
    tornUserId,
    stats: { strength: 10, defense: 20, speed: 30, dexterity: 40, total: 100 },
    statsAt: "2026-09-05T00:00:00.000Z",
    roles: [],
    rolesMessage: "none",
    source: "torn",
    ...overrides,
  };
}

describe.sequential("organized crimes store", () => {
  const originalPath = process.env.CHAINWARD_LOCAL_DB_PATH;
  const originalAppData = process.env.CHAINWARD_APP_DATA_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let directory: string | null = null;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "chainward-oc-store-"));
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(directory, "oc.sqlite");
    process.env.CHAINWARD_APP_DATA_DIR = path.join(directory, "appdata");
    delete process.env.DATABASE_URL;
    createLocalDatabase();
  });

  afterEach(() => {
    if (originalPath === undefined) delete process.env.CHAINWARD_LOCAL_DB_PATH; else process.env.CHAINWARD_LOCAL_DB_PATH = originalPath;
    if (originalAppData === undefined) delete process.env.CHAINWARD_APP_DATA_DIR; else process.env.CHAINWARD_APP_DATA_DIR = originalAppData;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = null;
  });

  it("round-trips a member record and removes it on withdrawal", async () => {
    await saveMemberIntel(FACTION, intel(111, { rolesMessage: "one" }));
    await saveMemberIntel(FACTION, intel(222, { rolesMessage: "two" }));

    expect((await readMemberIntel(FACTION.id)).map((record) => record.tornUserId).sort()).toEqual([111, 222]);

    await deleteMemberIntel(FACTION.id, 111);
    const remaining = await readMemberIntel(FACTION.id);
    expect(remaining.map((record) => record.tornUserId)).toEqual([222]);
  });

  it("overwrites the previous record for the same member", async () => {
    await saveMemberIntel(FACTION, intel(111, { rolesMessage: "first" }));
    await saveMemberIntel(FACTION, intel(111, { rolesMessage: "second" }));
    const records = await readMemberIntel(FACTION.id);
    expect(records).toHaveLength(1);
    expect(records[0]?.rolesMessage).toBe("second");
  });

  it("filters to a single member when asked", async () => {
    await saveMemberIntel(FACTION, intel(111));
    await saveMemberIntel(FACTION, intel(222));
    expect((await readMemberIntel(FACTION.id, 222)).map((record) => record.tornUserId)).toEqual([222]);
  });

  it("refuses a record whose faction does not match the target", async () => {
    await expect(saveMemberIntel(FACTION, intel(111, { factionId: 9_999 }))).rejects.toThrow(/different faction/i);
  });

  it("refuses a structurally invalid record", async () => {
    await expect(saveMemberIntel(FACTION, { ...intel(111), stats: { strength: -1 } } as unknown as MemberIntel)).rejects.toThrow();
  });

  it("returns the default review settings until they are written", async () => {
    expect(await readOcReviewSettings(FACTION.id)).toEqual({ minimumCpr: 70 });
    await writeOcReviewSettings(FACTION, { minimumCpr: 85 });
    expect(await readOcReviewSettings(FACTION.id)).toEqual({ minimumCpr: 85 });
  });

  it("round-trips a per-member share preference and defaults to off", async () => {
    expect(await readOcSharePreference(FACTION.id, 111)).toEqual({ autoShare: false, lastAutoShareAt: null });
    await writeOcSharePreference(FACTION, 111, { autoShare: true, lastAutoShareAt: "2026-09-05T00:00:00.000Z" });
    expect(await readOcSharePreference(FACTION.id, 111)).toEqual({ autoShare: true, lastAutoShareAt: "2026-09-05T00:00:00.000Z" });
    // Scoped per member.
    expect(await readOcSharePreference(FACTION.id, 222)).toEqual({ autoShare: false, lastAutoShareAt: null });
  });
});
