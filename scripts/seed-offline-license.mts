/**
 * Grants the offline test faction an active licence by running the same store
 * functions the unlock and administration screens call. Used by
 * `scripts/verify-offline.mjs` so the operational routes can be exercised
 * without driving the browser through the two-step approval flow.
 */
import { randomUUID } from "node:crypto";
import { openLocalDatabase } from "../src/lib/data/local-database";
import { revertChainSettlement, savePaidChainSettlement, type ChainMemberReward, type ChainSettlement } from "../src/lib/rewards/chain-settlement";
import type { TornChainReportView } from "../src/lib/torn/workspace-types";
import { getLocalAccessRequestQueue, reviewLocalAccessRequest, submitLocalAccessRequest } from "../src/lib/licensing/local-license-store";
import { licensePlans } from "../src/lib/licensing/pricing";
import { PLATFORM_OWNER } from "../src/lib/auth/platform-owner";
import { OFFLINE_FACTION } from "../src/lib/torn/offline-fixture";

const SCHEME_NAME = "Offline verification scheme";

const mode = process.argv[2] === "reset" ? "reset" : "grant";

if (mode === "reset") {
  resetOfflineFaction();
  process.exit(0);
}

const member = { name: "Offline Tester", tornUserId: 9_000_001, isPlatformAdmin: false };
const owner = { name: PLATFORM_OWNER.name, tornUserId: PLATFORM_OWNER.tornUserId, isPlatformAdmin: true };
const plan = licensePlans.find((item) => item.id === "lifetime");
if (!plan) throw new Error("The lifetime plan is missing from the pricing table.");

const reference = `CW-${OFFLINE_FACTION.id}-OFFLINE01`;
const now = new Date();

try {
  submitLocalAccessRequest({
    actor: member,
    faction: { id: OFFLINE_FACTION.id, name: OFFLINE_FACTION.name, tag: OFFLINE_FACTION.tag },
    plan,
    reference,
    submittedAt: now,
  });
  console.log(`submitted access request ${reference}`);
} catch (error) {
  console.log(`request not submitted: ${error instanceof Error ? error.message : String(error)}`);
}

// The queue view maps the stored status to its display label, so match on the
// reference and treat anything not yet decided as reviewable.
const pending = getLocalAccessRequestQueue().requests.find((request) => request.reference === reference && (request.status === "Pending" || request.status === "Information"));
if (!pending) {
  console.log("no pending request to approve; assuming access is already active");
} else {
  reviewLocalAccessRequest({
    actor: owner,
    requestId: pending.requestId,
    decision: "Approved",
    note: "Approved by the offline verification script.",
    referenceConfirmation: reference,
    reviewedAt: now,
    plans: licensePlans,
  });
  console.log(`approved ${reference} for faction ${OFFLINE_FACTION.id}`);
}

seedRewardScheme();
await seedSettlements();

/**
 * Clears only the fixture faction's records so a repeat run still exercises the
 * locked state. Records belonging to a real connected faction are untouched.
 */
function resetOfflineFaction(): void {
  const database = openLocalDatabase();
  if (!database) {
    console.log("local database unavailable; nothing to reset");
    return;
  }
  try {
    for (const statement of [
      "DELETE FROM licensing_faction_licenses WHERE faction_id = ?",
      "DELETE FROM licensing_access_requests WHERE faction_id = ?",
      "DELETE FROM reward_tiers WHERE scheme_id IN (SELECT id FROM reward_schemes WHERE faction_id = ?)",
      "DELETE FROM reward_schemes WHERE faction_id = ?",
      "DELETE FROM chain_settlements WHERE faction_id = ?",
      "DELETE FROM chain_settlement_reverts WHERE faction_id = ?",
    ]) {
      database.prepare(statement).run(OFFLINE_FACTION.id);
    }
    console.log(`reset offline fixture records for faction ${OFFLINE_FACTION.id}`);
  } finally {
    database.close();
  }
}

/** Gives the reward console a saved scheme so the editor, not the empty state, renders. */
function seedRewardScheme(): void {
  const database = openLocalDatabase();
  if (!database) {
    console.log("local database unavailable; reward scheme not seeded");
    return;
  }
  try {
    const existing = database.prepare("SELECT id FROM reward_schemes WHERE faction_id = ? AND name = ?").get(OFFLINE_FACTION.id, SCHEME_NAME) as { id: string } | undefined;
    if (existing) {
      console.log("reward scheme already seeded");
      return;
    }
    const id = randomUUID();
    const timestamp = now.toISOString();
    database.prepare(`
      INSERT INTO reward_schemes (id, faction_id, name, description, version, status, is_default, reward_name, reward_unit, locked_by_history, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 'ACTIVE', 1, 'Xanax', 'Xanax', 0, ?, ?)
    `).run(id, OFFLINE_FACTION.id, SCHEME_NAME, "Created by scripts/verify-offline.mjs.", timestamp, timestamp);
    const tiers: [string, number, number | null, number][] = [
      ["Below threshold", 0, 5, 0],
      ["Entry", 6, 15, 1],
      ["Steady", 16, 25, 2],
      ["Committed", 26, 35, 3],
      ["High", 36, 45, 4],
      ["Top", 46, null, 5],
    ];
    const insert = database.prepare("INSERT INTO reward_tiers (id, scheme_id, label, minimum_hits, maximum_hits, amount, enabled, position) VALUES (?, ?, ?, ?, ?, ?, 1, ?)");
    tiers.forEach(([label, minimum, maximum, amount], position) => insert.run(randomUUID(), id, label, minimum, maximum, amount, position));
    console.log(`seeded reward scheme "${SCHEME_NAME}" with ${tiers.length} tiers`);
  } finally {
    database.close();
  }
}

/**
 * Puts a paid chain and a withdrawn one into the register.
 *
 * The payout ledger only ever lists acknowledged settlements, so without this
 * the offline run would exercise nothing but its empty state — the ranked
 * recipients and the corrections record would never render.
 */
async function seedSettlements(): Promise<void> {
  const database = openLocalDatabase();
  if (!database) {
    console.log("local database unavailable; settlements not seeded");
    return;
  }
  const existing = database.prepare("SELECT COUNT(*) AS total FROM chain_settlements WHERE faction_id = ?").get(OFFLINE_FACTION.id) as { total: number };
  database.close();
  if (existing.total > 0) {
    console.log("chain settlements already seeded");
    return;
  }

  // 7000003 stays paid; 7000001 is paid and then withdrawn, which is the only
  // way to produce a correction record.
  await markPaid(7_000_003, 500);
  await markPaid(7_000_001, 100);
  await revertChainSettlement(OFFLINE_FACTION.id, 7_000_001, {
    reason: "Marked paid before the items were actually sent; re-issuing after the next faction bank run.",
    revertedAt: now.toISOString(),
    revertedByTornId: owner.tornUserId,
    revertedByName: owner.name,
  });
  console.log("seeded 2 paid chain settlements and 1 withdrawal");
}

async function markPaid(chainId: number, hits: number): Promise<void> {
  const members = fixtureMembers(hits);
  const settlement: ChainSettlement = {
    available: true,
    message: "Seeded by scripts/verify-offline.mjs.",
    schemeId: null,
    schemeName: SCHEME_NAME,
    schemeVersion: 1,
    rewardUnit: "Xanax",
    totalAmount: members.reduce((total, member) => total + member.amount, 0),
    members,
    factionId: OFFLINE_FACTION.id,
    chainId,
    status: "PAID",
    calculatedAt: now.toISOString(),
    paidAt: now.toISOString(),
    paidByTornId: owner.tornUserId,
  };
  const report: TornChainReportView = {
    id: chainId,
    factionId: OFFLINE_FACTION.id,
    startedAt: Math.floor(now.getTime() / 1_000) - 604_800,
    endedAt: Math.floor(now.getTime() / 1_000) - 583_200,
    hits,
    respect: hits * 16.42,
    contributorCount: members.length,
    targetCount: Math.ceil(hits * 0.74),
    contributions: members.map((member, index) => ({ rank: index + 1, name: member.memberName, tornId: member.tornUserId, hits: member.hits, contribution: member.hits / hits, respect: member.hits * 16.42, status: null })),
  };
  await savePaidChainSettlement(settlement, report, owner.name);
}

/** Mirrors the hit split the offline chain report fixture returns. */
function fixtureMembers(hits: number): ChainMemberReward[] {
  const roster: [number, string][] = [
    [PLATFORM_OWNER.tornUserId, PLATFORM_OWNER.name],
    [9_000_001, "Offline Tester"],
    [9_000_002, "Chain Runner"],
    [9_000_003, "Bridge Watch"],
    [9_000_004, "Quiet Hand"],
    [9_000_005, "Late Joiner"],
  ];
  const weights = [0.24, 0.21, 0.18, 0.15, 0.13, 0.09];
  const allocated = weights.map((weight) => Math.floor(hits * weight));
  allocated[0] = (allocated[0] ?? 0) + hits - allocated.reduce((total, value) => total + value, 0);
  return roster.map(([tornUserId, memberName], index) => {
    const memberHits = allocated[index] ?? 0;
    const [tierLabel, amount] = tierFor(memberHits);
    return { tornUserId, memberName, hits: memberHits, tierLabel, amount };
  });
}

/** The ladder seeded into the reward scheme above. */
function tierFor(hits: number): [string, number] {
  if (hits >= 46) return ["Top", 5];
  if (hits >= 36) return ["High", 4];
  if (hits >= 26) return ["Committed", 3];
  if (hits >= 16) return ["Steady", 2];
  if (hits >= 6) return ["Entry", 1];
  return ["Below threshold", 0];
}
