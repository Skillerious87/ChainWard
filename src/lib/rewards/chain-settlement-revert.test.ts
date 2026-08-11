import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const workspace = mkdtempSync(path.join(tmpdir(), "chainward-settlement-"));
const databasePath = path.join(workspace, "chainward-local.sqlite");

beforeAll(() => {
  process.env.CHAINWARD_LOCAL_TEST_MODE = "true";
  process.env.CHAINWARD_LOCAL_DB_PATH = databasePath;
  delete process.env.DATABASE_URL;
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function correction(reason: string) {
  return { reason, revertedAt: new Date().toISOString(), revertedByTornId: 3_212_954, revertedByName: "Skillerious" };
}

const FACTION_ID = 98_765;
const CHAIN_ID = 7_000_003;

async function seedPaidSettlement(): Promise<void> {
  const { createLocalDatabase, openLocalDatabase } = await import("@/lib/data/local-database");
  createLocalDatabase();
  const database = openLocalDatabase();
  if (!database) throw new Error("The temporary database could not be opened.");
  try {
    const members = [{ tornUserId: 1, memberName: "Paid Member", hits: 40, amount: 4, tierLabel: "High" }];
    database.prepare(`INSERT INTO chain_settlements (faction_id, chain_id, status, scheme_id, scheme_name, scheme_version, reward_unit, total_amount, member_count, snapshot_json, calculated_at, paid_at, paid_by_torn_id, paid_by_name)
      VALUES (?, ?, 'PAID', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(FACTION_ID, CHAIN_ID, "scheme-1", "Standard chain rewards", 1, "Xanax", 4, 1, JSON.stringify(members), new Date().toISOString(), new Date().toISOString(), 3_212_954, "Skillerious");
  } finally { database.close(); }
}

describe("withdrawing a payout acknowledgement", () => {
  it("returns a chain marked paid in error to its unpaid state", async () => {
    const { getChainSettlement, revertChainSettlement } = await import("./chain-settlement");
    await seedPaidSettlement();

    expect(await getChainSettlement(FACTION_ID, CHAIN_ID)).toMatchObject({ status: "PAID", totalAmount: 4 });

    await revertChainSettlement(FACTION_ID, CHAIN_ID, correction("Marked paid before the Xanax was sent."));

    // The chain reads as unsettled again, so the report falls back to a live
    // preview and the history screen counts it as outstanding.
    expect(await getChainSettlement(FACTION_ID, CHAIN_ID)).toBeNull();
  });

  it("leaves other factions' settlements untouched", async () => {
    const { getChainSettlement, revertChainSettlement } = await import("./chain-settlement");
    const { openLocalDatabase } = await import("@/lib/data/local-database");
    await seedPaidSettlement();
    const database = openLocalDatabase();
    if (!database) throw new Error("The temporary database could not be opened.");
    try {
      database.prepare(`INSERT INTO chain_settlements (faction_id, chain_id, status, scheme_id, scheme_name, scheme_version, reward_unit, total_amount, member_count, snapshot_json, calculated_at, paid_at, paid_by_torn_id, paid_by_name)
        VALUES (?, ?, 'PAID', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(12_345, CHAIN_ID, "scheme-1", "Other faction scheme", 1, "Xanax", 9, 1, "[]", new Date().toISOString(), new Date().toISOString(), 1, "Someone");
    } finally { database.close(); }

    await revertChainSettlement(FACTION_ID, CHAIN_ID, correction("Marked paid before the Xanax was sent."));

    expect(await getChainSettlement(FACTION_ID, CHAIN_ID)).toBeNull();
    expect(await getChainSettlement(12_345, CHAIN_ID)).toMatchObject({ status: "PAID", totalAmount: 9 });
  });

  it("is safe to run when no settlement is stored", async () => {
    const { revertChainSettlement } = await import("./chain-settlement");
    await expect(revertChainSettlement(FACTION_ID, 999_999, correction("Nothing to withdraw here."))).resolves.toBeUndefined();
  });
});

describe("payout withdrawal records", () => {
  it("keeps the stated reason and the withdrawn amount", async () => {
    const { getLocalPayoutReverts, revertChainSettlement } = await import("./chain-settlement");
    await seedPaidSettlement();

    await revertChainSettlement(FACTION_ID, CHAIN_ID, correction("Marked paid before the Xanax was actually sent."));

    const [record] = getLocalPayoutReverts(FACTION_ID);
    expect(record).toMatchObject({
      chainId: CHAIN_ID,
      reason: "Marked paid before the Xanax was actually sent.",
      totalAmount: 4,
      rewardUnit: "Xanax",
      revertedByName: "Skillerious",
    });
  });

  it("records a withdrawal even when the settlement row has already gone", async () => {
    const { getLocalPayoutReverts, revertChainSettlement } = await import("./chain-settlement");
    await revertChainSettlement(FACTION_ID, 424_242, correction("Cleaning up a duplicate record."));

    const records = getLocalPayoutReverts(FACTION_ID);
    expect(records.some((record) => record.chainId === 424_242 && record.reason === "Cleaning up a duplicate record.")).toBe(true);
  });
});
