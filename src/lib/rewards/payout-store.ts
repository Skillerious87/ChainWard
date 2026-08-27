import "server-only";

import { localDatabaseExists, openLocalDatabase } from "@/lib/data/local-database";
import type { ChainMemberReward } from "./chain-settlement";

export interface PayoutLedgerEntry {
  id: string;
  chainId: number;
  tornUserId: number;
  memberName: string;
  amount: number;
  rewardUnit: string;
  tierLabel: string | null;
  status: "PENDING" | "APPROVED" | "PAID" | "HELD" | "WAIVED";
  createdAt: string;
  processedAt: string | null;
  processedBy: { tornUserId: number; name: string } | null;
}

type PersistedPayoutStatus = PayoutLedgerEntry["status"];

export interface PayoutLedgerResult {
  databaseConfigured: boolean;
  databaseAvailable: boolean;
  entries: PayoutLedgerEntry[];
  message: string;
}

export async function getPayoutLedger(tornFactionId: number | null, knownNames: Readonly<Record<number, string>> = {}): Promise<PayoutLedgerResult> {
  const hasPostgres = Boolean(process.env.DATABASE_URL?.trim());
  if (!hasPostgres && !localDatabaseExists()) return empty(false, false, "Create local storage in Settings before recording payouts.");
  if (!tornFactionId) return empty(true, true, "Connect a verified Torn faction to view its payout ledger.");
  if (!hasPostgres) return getLocalLedger(tornFactionId, knownNames);
  try {
    const { db } = await import("@/lib/db");
    const rows = await db.memberPayout.findMany({
      where: { faction: { tornFactionId } },
      select: {
        id: true, snapshotId: true, tornUserId: true, memberName: true, amount: true,
        status: true, createdAt: true, processedAt: true,
        snapshot: { select: { chain: { select: { tornChainId: true } } } },
        rewardDefinition: { select: { displayUnit: true } },
        processedBy: { select: { name: true, tornUserId: true } },
      },
      orderBy: [{ processedAt: "desc" }, { createdAt: "desc" }],
    });
    // A snapshot calculation contains every member. Including it through each
    // payout row multiplied the same JSON by the member count; fetch every
    // distinct snapshot once and join it in memory instead.
    const snapshotIds = [...new Set(rows.map((row) => row.snapshotId))];
    const snapshots = snapshotIds.length ? await db.chainRewardSnapshot.findMany({
      where: { id: { in: snapshotIds } },
      select: { id: true, calculation: true },
    }) : [];
    const calculationBySnapshot = new Map(snapshots.map((snapshot) => [snapshot.id, parseCalculation(snapshot.calculation)]));
    const tierByMember = new Map<string, string | null>();
    for (const row of rows) {
      const calculation = calculationBySnapshot.get(row.snapshotId);
      const member = calculation?.find((item) => item.tornUserId === row.tornUserId);
      tierByMember.set(row.id, member?.tierLabel ?? null);
    }
    const entries = rows.map<PayoutLedgerEntry>((row) => {
      const amount = Number(row.amount);
      return { id: row.id, chainId: row.snapshot.chain.tornChainId, tornUserId: row.tornUserId, memberName: row.memberName, amount, rewardUnit: row.rewardDefinition.displayUnit, tierLabel: tierByMember.get(row.id) ?? null, status: normalizePayoutStatus(amount, row.status), createdAt: row.createdAt.toISOString(), processedAt: row.processedAt?.toISOString() ?? null, processedBy: row.processedBy ? { name: row.processedBy.name, tornUserId: row.processedBy.tornUserId } : null };
    });
    return { databaseConfigured: true, databaseAvailable: true, entries, message: entries.length ? `${entries.length} persisted member reward decision${entries.length === 1 ? "" : "s"}.` : "No payout records have been created for this faction." };
  } catch { return empty(true, false, "The configured PostgreSQL payout register could not be queried."); }
}

function getLocalLedger(factionId: number, knownNames: Readonly<Record<number, string>>): PayoutLedgerResult {
  const database = openLocalDatabase();
  if (!database) return empty(false, false, "The local database file is unavailable.");
  try {
    const rows = database.prepare("SELECT chain_id, reward_unit, snapshot_json, calculated_at, paid_at, paid_by_torn_id, paid_by_name FROM chain_settlements WHERE faction_id = ? AND status = 'PAID' ORDER BY paid_at DESC").all(factionId) as unknown as LocalSettlementRow[];
    const entries = rows.flatMap<PayoutLedgerEntry>((row) => parseMembers(row.snapshot_json).map((member) => ({ id: `${factionId}:${row.chain_id}:${member.tornUserId}`, chainId: row.chain_id, tornUserId: member.tornUserId, memberName: member.memberName, amount: member.amount, rewardUnit: row.reward_unit, tierLabel: member.tierLabel, status: normalizePayoutStatus(member.amount, "PAID"), createdAt: row.calculated_at, processedAt: row.paid_at, processedBy: row.paid_by_torn_id ? { tornUserId: row.paid_by_torn_id, name: row.paid_by_name || knownNames[row.paid_by_torn_id] || "Unknown user" } : null })));
    return { databaseConfigured: true, databaseAvailable: true, entries, message: entries.length ? `${entries.length} local member reward decision${entries.length === 1 ? "" : "s"}.` : "No paid chains are stored in the local database yet." };
  } catch { return empty(true, false, "The local payout register could not be read safely."); }
  finally { database.close(); }
}

function parseCalculation(value: unknown): ChainMemberReward[] | null {
  if (!value || typeof value !== "object" || !("members" in value) || !Array.isArray(value.members)) return null;
  return value.members as ChainMemberReward[];
}

function parseMembers(value: string): ChainMemberReward[] {
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed as ChainMemberReward[] : []; }
  catch { return []; }
}

/** Zero-value reward decisions are resolved by policy, never by payment. */
function normalizePayoutStatus(amount: number, status: PersistedPayoutStatus): PersistedPayoutStatus {
  return amount <= 0 ? "WAIVED" : status;
}

function empty(databaseConfigured: boolean, databaseAvailable: boolean, message: string): PayoutLedgerResult { return { databaseConfigured, databaseAvailable, entries: [], message }; }

interface LocalSettlementRow { chain_id: number; reward_unit: string; snapshot_json: string; calculated_at: string; paid_at: string | null; paid_by_torn_id: number | null; paid_by_name: string | null }
