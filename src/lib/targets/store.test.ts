import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalDatabase } from "@/lib/data/local-database";
import {
  addTargetEntry,
  mergeSnapshots,
  readTargetList,
  removeTargetEntry,
  setTargetNote,
  writeTargetList,
} from "./store";
import { MAX_TARGETS, type TargetEntry, type TargetList, type TargetSnapshot } from "./types";

const faction = { id: 51393, name: "Prive Cartel", tag: "PC" };
const OPERATOR = 3_212_954;

function entry(tornUserId: number): TargetEntry {
  return { tornUserId, label: `Target ${tornUserId}`, note: "", addedAt: new Date().toISOString() };
}

function snapshot(tornUserId: number): TargetSnapshot {
  return {
    tornUserId, name: `Target ${tornUserId}`, level: 30, factionId: null, factionName: "", position: "",
    status: { description: "Okay", state: "Okay", until: null, color: "green" },
    lastActionAt: 1_700_000_000, lastActionRelative: "1 hour ago", lifeCurrent: 100, lifeMaximum: 100,
    attackable: true, fetchedAt: new Date().toISOString(),
  };
}

describe.sequential("targets store", () => {
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

  it("round-trips entries and snapshots and isolates operators", async () => {
    useTempDatabase("targets");
    const list: TargetList = mergeSnapshots(
      { entries: [entry(11), entry(22)], snapshots: {} },
      [snapshot(11), snapshot(22)],
    );
    await writeTargetList(faction, OPERATOR, list);
    await writeTargetList(faction, 999, { entries: [entry(77)], snapshots: {} });

    const mine = await readTargetList(faction.id, OPERATOR);
    expect(mine.entries.map((item) => item.tornUserId)).toEqual([11, 22]);
    expect(mine.snapshots["11"]!.name).toBe("Target 11");

    const other = await readTargetList(faction.id, 999);
    expect(other.entries.map((item) => item.tornUserId)).toEqual([77]);
  });

  it("prunes snapshots whose entry has been removed", async () => {
    useTempDatabase("targets-prune");
    await writeTargetList(faction, OPERATOR, mergeSnapshots({ entries: [entry(11), entry(22)], snapshots: {} }, [snapshot(11), snapshot(22)]));
    const trimmed = removeTargetEntry(await readTargetList(faction.id, OPERATOR), 11);
    await writeTargetList(faction, OPERATOR, trimmed);

    const reloaded = await readTargetList(faction.id, OPERATOR);
    expect(reloaded.entries.map((item) => item.tornUserId)).toEqual([22]);
    expect(reloaded.snapshots["11"]).toBeUndefined();
  });

  it("edits a note in place", async () => {
    useTempDatabase("targets-note");
    await writeTargetList(faction, OPERATOR, { entries: [entry(11)], snapshots: {} });
    const updated = setTargetNote(await readTargetList(faction.id, OPERATOR), 11, "Priority — war target");
    await writeTargetList(faction, OPERATOR, updated);
    expect((await readTargetList(faction.id, OPERATOR)).entries[0]!.note).toBe("Priority — war target");
  });

  it("rejects duplicates and enforces the target cap", () => {
    const base: TargetList = { entries: [entry(1)], snapshots: {} };
    expect(() => addTargetEntry(base, entry(1))).toThrow("already on your target list");

    let list: TargetList = { entries: [], snapshots: {} };
    for (let i = 1; i <= MAX_TARGETS; i += 1) list = addTargetEntry(list, entry(i));
    expect(list.entries).toHaveLength(MAX_TARGETS);
    expect(() => addTargetEntry(list, entry(MAX_TARGETS + 1))).toThrow(`at most ${MAX_TARGETS}`);
  });
});
