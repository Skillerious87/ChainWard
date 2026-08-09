import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalDatabase, localDatabaseExists, openLocalDatabase } from "./local-database";
import { getPayoutLedger } from "@/lib/rewards/payout-store";

describe.sequential("local SQLite database", () => {
  const originalPath = process.env.CHAINWARD_LOCAL_DB_PATH;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let temporaryDirectory: string | null = null;

  afterEach(() => {
    if (originalPath === undefined) delete process.env.CHAINWARD_LOCAL_DB_PATH;
    else process.env.CHAINWARD_LOCAL_DB_PATH = originalPath;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = null;
  });

  it("creates a real database file with reward and settlement tables", () => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "chainward-sqlite-"));
    const databasePath = path.join(temporaryDirectory, "workspace.sqlite");
    process.env.CHAINWARD_LOCAL_DB_PATH = databasePath;

    const info = createLocalDatabase();
    expect(info.path).toBe(databasePath);
    expect(existsSync(databasePath)).toBe(true);
    expect(localDatabaseExists()).toBe(true);

    const database = openLocalDatabase();
    expect(database).not.toBeNull();
    try {
      const tables = database!.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as unknown as { name: string }[];
      expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining(["reward_schemes", "reward_tiers", "chain_settlements", "faction_settings", "faction_access_assignments", "faction_access_audit", "member_activity_audit", "licensing_access_requests", "licensing_faction_licenses", "licensing_audit"]));
      expect(tables.map((table) => table.name)).not.toContain("remembered_torn_connections");
    } finally { database?.close(); }
  });

  it("returns member payouts from an explicitly paid local chain", async () => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "chainward-ledger-"));
    process.env.CHAINWARD_LOCAL_DB_PATH = path.join(temporaryDirectory, "ledger.sqlite");
    delete process.env.DATABASE_URL;
    createLocalDatabase();
    const database = openLocalDatabase();
    try {
      database!.prepare("INSERT INTO chain_settlements (faction_id, chain_id, status, scheme_name, scheme_version, reward_unit, total_amount, member_count, snapshot_json, calculated_at, paid_at, paid_by_torn_id) VALUES (?, ?, 'PAID', ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(51393, 58410291, "Standard chain", 1, "Xanax", 5, 1, JSON.stringify([{ tornUserId: 3212954, memberName: "Skillerious", hits: 46, tierLabel: "Top", amount: 5 }]), "2026-08-08T20:00:00.000Z", "2026-08-08T20:05:00.000Z", 3212954);
    } finally { database?.close(); }

    const ledger = await getPayoutLedger(51393);
    expect(ledger.databaseAvailable).toBe(true);
    expect(ledger.entries).toEqual([expect.objectContaining({ chainId: 58410291, tornUserId: 3212954, amount: 5, rewardUnit: "Xanax", status: "PAID" })]);
  });
});
