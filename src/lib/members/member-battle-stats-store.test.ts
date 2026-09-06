import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalDatabase } from "@/lib/data/local-database";
import type { MemberBattleStats } from "./member-battle-stats";
import {
  deleteMemberBattleStats,
  getMemberBattleStatsWorkspace,
  readBattleStatsSharePreference,
  readMemberBattleStats,
  saveMemberBattleStats,
  writeBattleStatsSharePreference,
} from "./member-battle-stats-store";

const faction = { id: 51393, name: "Prive Cartel", tag: "PC" };

function record(tornUserId: number, total: number): MemberBattleStats {
  const each = Math.round(total / 4);
  return {
    factionId: faction.id,
    tornUserId,
    stats: { strength: each, defense: each, speed: each, dexterity: each, total },
    statsAt: new Date().toISOString(),
    source: "offline",
  };
}

describe.sequential("member battle-stats store", () => {
  const originalPath = process.env.CHAINWARD_LOCAL_DB_PATH;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let directory: string | null = null;

  afterEach(() => {
    if (originalPath === undefined) delete process.env.CHAINWARD_LOCAL_DB_PATH; else process.env.CHAINWARD_LOCAL_DB_PATH = originalPath;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = null;
  });

  function useTempDatabase(name: string): void {
    directory = mkdtempSync(path.join(tmpdir(), `chainward-${name}-`));
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(directory, `${name}.sqlite`);
    delete process.env.DATABASE_URL;
    createLocalDatabase();
  }

  it("round-trips shared battle stats and scopes reads to one member", async () => {
    useTempDatabase("battle-stats");
    await saveMemberBattleStats(faction, record(101, 4_000_000_000));
    await saveMemberBattleStats(faction, record(202, 1_200_000_000));

    const all = await readMemberBattleStats(faction.id);
    expect(all).toHaveLength(2);

    const one = await readMemberBattleStats(faction.id, 101);
    expect(one).toHaveLength(1);
    expect(one[0]!.stats.total).toBe(4_000_000_000);

    await deleteMemberBattleStats(faction.id, 101);
    expect(await readMemberBattleStats(faction.id)).toHaveLength(1);
  });

  it("overwrites a member's own record rather than appending", async () => {
    useTempDatabase("battle-stats-overwrite");
    await saveMemberBattleStats(faction, record(101, 1_000));
    await saveMemberBattleStats(faction, record(101, 9_999));
    const all = await readMemberBattleStats(faction.id);
    expect(all).toHaveLength(1);
    expect(all[0]!.stats.total).toBe(9_999);
  });

  it("rejects a record whose faction does not match", async () => {
    useTempDatabase("battle-stats-faction");
    await expect(saveMemberBattleStats(faction, { ...record(101, 1_000), factionId: 999 })).rejects.toThrow("different faction");
  });

  it("defaults, stores and reads back the auto-share preference", async () => {
    useTempDatabase("battle-stats-pref");
    expect(await readBattleStatsSharePreference(faction.id, 101)).toEqual({ autoShare: false, lastAutoShareAt: null });

    const stamp = new Date().toISOString();
    await writeBattleStatsSharePreference(faction, 101, { autoShare: true, lastAutoShareAt: stamp });
    expect(await readBattleStatsSharePreference(faction.id, 101)).toEqual({ autoShare: true, lastAutoShareAt: stamp });
  });

  it("summarises the workspace and degrades cleanly without storage", async () => {
    useTempDatabase("battle-stats-workspace");
    await saveMemberBattleStats(faction, record(101, 4_000_000_000));
    const workspace = await getMemberBattleStatsWorkspace(faction.id);
    expect(workspace.databaseAvailable).toBe(true);
    expect(workspace.records).toHaveLength(1);

    expect(await getMemberBattleStatsWorkspace(null)).toMatchObject({ records: [] });
  });
});
