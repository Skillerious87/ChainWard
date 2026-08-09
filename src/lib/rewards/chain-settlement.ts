import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { localDatabaseExists, openLocalDatabase } from "@/lib/data/local-database";
import { calculateRewards } from "./reward-engine";
import type { RewardSchemeView, RewardWorkspaceView } from "./reward-store";
import type { TornChainReportView } from "@/lib/torn/workspace-types";

export interface ChainMemberReward {
  tornUserId: number;
  memberName: string;
  hits: number;
  tierLabel: string | null;
  amount: number;
}

export interface ChainRewardPreview {
  available: boolean;
  message: string;
  schemeId: string | null;
  schemeName: string | null;
  schemeVersion: number | null;
  rewardUnit: string | null;
  totalAmount: number;
  members: ChainMemberReward[];
}

export interface ChainSettlement extends ChainRewardPreview {
  factionId: number;
  chainId: number;
  status: "READY" | "PAID";
  calculatedAt: string;
  paidAt: string | null;
  paidByTornId: number | null;
}

export interface ChainSettlementSummary {
  status: "READY" | "PAID";
  totalAmount: number;
  rewardUnit: string;
  memberCount: number;
  paidAt: string | null;
}

export function calculateChainRewardPreview(report: TornChainReportView, workspace: RewardWorkspaceView): ChainRewardPreview {
  const active = workspace.schemes.filter((scheme) => scheme.status === "ACTIVE");
  const scheme = active.find((item) => item.isDefault) ?? (active.length === 1 ? active[0] : null);
  if (!scheme) return { available: false, message: active.length > 1 ? "Choose a default reward scheme before calculating this chain." : "Create an active reward scheme before calculating this chain.", schemeId: null, schemeName: null, schemeVersion: null, rewardUnit: null, totalAmount: 0, members: [] };
  return calculateWithScheme(report, scheme);
}

export async function getChainSettlement(factionId: number, chainId: number): Promise<ChainSettlement | null> {
  if (!process.env.DATABASE_URL) return getLocalSettlement(factionId, chainId);
  try {
    const { db } = await import("@/lib/db");
    const snapshot = await db.chainRewardSnapshot.findFirst({
      where: { status: "FINAL", chain: { tornChainId: chainId, faction: { tornFactionId: factionId } } },
      orderBy: { calculatedAt: "desc" },
    });
    const stored = snapshot ? parseSettlement(snapshot.calculation) : null;
    if (stored) return stored;
    // Compatibility with early local builds that stored the snapshot as a setting.
    const setting = await db.factionSetting.findFirst({ where: { faction: { tornFactionId: factionId }, key: settlementKey(chainId) } });
    return setting ? parseSettlement(setting.value) : null;
  } catch { return null; }
}

export async function getChainSettlementSummaries(factionId: number, chainIds: number[]): Promise<Record<number, ChainSettlementSummary>> {
  if (chainIds.length === 0) return {};
  const settlements: ChainSettlement[] = [];
  if (!process.env.DATABASE_URL) {
    const database = openLocalDatabase();
    if (!database) return {};
    try {
      const placeholders = chainIds.map(() => "?").join(",");
      const rows = database.prepare(`SELECT * FROM chain_settlements WHERE faction_id = ? AND chain_id IN (${placeholders})`).all(factionId, ...chainIds) as unknown as LocalSettlementRow[];
      settlements.push(...rows.map(mapLocalSettlement));
    } finally { database.close(); }
  } else {
    try {
      const { db } = await import("@/lib/db");
      const snapshots = await db.chainRewardSnapshot.findMany({
        where: { status: "FINAL", chain: { faction: { tornFactionId: factionId }, tornChainId: { in: chainIds } } },
        orderBy: { calculatedAt: "desc" },
      });
      for (const snapshot of snapshots) { const parsed = parseSettlement(snapshot.calculation); if (parsed && !settlements.some((item) => item.chainId === parsed.chainId)) settlements.push(parsed); }
      const rows = await db.factionSetting.findMany({ where: { faction: { tornFactionId: factionId }, key: { in: chainIds.map(settlementKey) } } });
      for (const row of rows) { const parsed = parseSettlement(row.value); if (parsed && !settlements.some((item) => item.chainId === parsed.chainId)) settlements.push(parsed); }
    } catch { return {}; }
  }
  return Object.fromEntries(settlements.map((item) => [item.chainId, { status: item.status, totalAmount: item.totalAmount, rewardUnit: item.rewardUnit ?? "units", memberCount: item.members.length, paidAt: item.paidAt }]));
}

export async function savePaidChainSettlement(settlement: ChainSettlement, report: TornChainReportView, paidByName: string): Promise<void> {
  if (!process.env.DATABASE_URL) {
    if (!localDatabaseExists()) throw new Error("Create the local database in Settings before marking a chain paid.");
    const database = openLocalDatabase();
    if (!database) throw new Error("The local database is unavailable.");
    try {
      database.prepare(`INSERT INTO chain_settlements (faction_id, chain_id, status, scheme_id, scheme_name, scheme_version, reward_unit, total_amount, member_count, snapshot_json, calculated_at, paid_at, paid_by_torn_id, paid_by_name)
        VALUES (?, ?, 'PAID', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(faction_id, chain_id) DO UPDATE SET status = 'PAID', scheme_id = excluded.scheme_id, scheme_name = excluded.scheme_name, scheme_version = excluded.scheme_version, reward_unit = excluded.reward_unit, total_amount = excluded.total_amount, member_count = excluded.member_count, snapshot_json = excluded.snapshot_json, calculated_at = excluded.calculated_at, paid_at = excluded.paid_at, paid_by_torn_id = excluded.paid_by_torn_id, paid_by_name = excluded.paid_by_name`).run(settlement.factionId, settlement.chainId, settlement.schemeId, settlement.schemeName, settlement.schemeVersion, settlement.rewardUnit, settlement.totalAmount, settlement.members.length, JSON.stringify(settlement.members), settlement.calculatedAt, settlement.paidAt, settlement.paidByTornId, paidByName);
      if (settlement.schemeId) database.prepare("UPDATE reward_schemes SET locked_by_history = 1 WHERE id = ? AND faction_id = ?").run(settlement.schemeId, settlement.factionId);
    } finally { database.close(); }
    return;
  }
  const { db } = await import("@/lib/db");
  await db.$transaction(async (tx) => {
    const faction = await tx.faction.findUnique({ where: { tornFactionId: settlement.factionId } });
    if (!faction) throw new Error("The connected faction is not stored in the database.");
    const scheme = await tx.rewardScheme.findFirst({ where: { id: settlement.schemeId!, factionId: faction.id }, include: { tiers: { include: { rewards: true } } } });
    if (!scheme) throw new Error("The reward scheme used for this calculation no longer exists.");
    const rewardDefinitionId = scheme.tiers.flatMap((tier) => tier.rewards)[0]?.rewardDefinitionId;
    if (!rewardDefinitionId) throw new Error("The reward scheme has no payable reward definition.");
    const processedBy = await tx.user.upsert({ where: { tornUserId: settlement.paidByTornId! }, update: { name: paidByName, lastAuthenticatedAt: new Date() }, create: { tornUserId: settlement.paidByTornId!, name: paidByName, lastAuthenticatedAt: new Date() } });
    const sourcePayload = JSON.parse(JSON.stringify(report)) as Prisma.InputJsonValue;
    const chain = await tx.chain.upsert({
      where: { factionId_tornChainId: { factionId: faction.id, tornChainId: report.id } },
      update: { status: "COMPLETED", currentHits: report.hits, maximumHits: report.hits, respect: report.respect, startedAt: new Date(report.startedAt * 1_000), endedAt: new Date(report.endedAt * 1_000), lastSyncedAt: new Date(), sourcePayload, assignedSchemeId: scheme.id },
      create: { factionId: faction.id, tornChainId: report.id, status: "COMPLETED", currentHits: report.hits, maximumHits: report.hits, respect: report.respect, startedAt: new Date(report.startedAt * 1_000), endedAt: new Date(report.endedAt * 1_000), lastSyncedAt: new Date(), sourcePayload, assignedSchemeId: scheme.id },
    });
    const contributionIds = new Map<number, string>();
    for (const member of report.contributions) {
      const contribution = await tx.chainMemberContribution.upsert({
        where: { chainId_tornUserId: { chainId: chain.id, tornUserId: member.tornId } },
        update: { memberName: member.name, hits: member.hits, respectTotal: member.respect, respectAverage: member.hits > 0 ? member.respect / member.hits : 0, attackBreakdown: { source: "torn-api-v2-chain-report" } },
        create: { chainId: chain.id, tornUserId: member.tornId, memberName: member.name, hits: member.hits, respectTotal: member.respect, respectAverage: member.hits > 0 ? member.respect / member.hits : 0, attackBreakdown: { source: "torn-api-v2-chain-report" } },
      });
      contributionIds.set(member.tornId, contribution.id);
    }
    await tx.chainRewardSnapshot.updateMany({ where: { chainId: chain.id, status: "FINAL" }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
    const calculation = JSON.parse(JSON.stringify(settlement)) as Prisma.InputJsonValue;
    const liabilityTotals = { totalAmount: settlement.totalAmount, rewardUnit: settlement.rewardUnit, memberCount: settlement.members.length } as Prisma.InputJsonValue;
    const snapshot = await tx.chainRewardSnapshot.create({ data: { chainId: chain.id, rewardSchemeId: scheme.id, schemeName: settlement.schemeName!, schemeVersion: settlement.schemeVersion!, status: "FINAL", calculation, liabilityTotals, calculatedAt: new Date(settlement.calculatedAt) } });
    await tx.memberPayout.createMany({ data: settlement.members.map((member) => ({ factionId: faction.id, snapshotId: snapshot.id, contributionId: contributionIds.get(member.tornUserId)!, rewardDefinitionId, tornUserId: member.tornUserId, memberName: member.memberName, amount: member.amount, status: "PAID" as const, processedById: processedBy.id, processedAt: new Date(settlement.paidAt!), note: `Chain #${settlement.chainId} payout acknowledgement` })) });
  });
}

export function settlementFromPreview(preview: ChainRewardPreview, factionId: number, chainId: number, paidByTornId: number, now = new Date()): ChainSettlement {
  if (!preview.available || !preview.schemeId || !preview.schemeName || preview.schemeVersion === null || !preview.rewardUnit) throw new Error(preview.message);
  return { ...preview, factionId, chainId, status: "PAID", calculatedAt: now.toISOString(), paidAt: now.toISOString(), paidByTornId };
}

function calculateWithScheme(report: TornChainReportView, scheme: RewardSchemeView): ChainRewardPreview {
  const calculation = calculateRewards(report.contributions.map((member) => ({ tornUserId: member.tornId, memberName: member.name, hits: member.hits })), {
    id: scheme.id,
    name: scheme.name,
    version: scheme.version,
    tiers: scheme.tiers.map((tier, position) => ({ id: tier.id, label: tier.label, minimumHits: tier.minimumHits, maximumHits: tier.maximumHits, position, enabled: tier.enabled, rewards: [{ reward: { id: `${scheme.id}-reward`, name: scheme.rewardName, displayUnit: scheme.rewardUnit, kind: "item", decimals: 0 }, amount: tier.amount }] })),
  });
  const members = calculation.members.map((member) => ({ tornUserId: member.tornUserId, memberName: member.memberName, hits: member.hits, tierLabel: member.tierLabel, amount: member.rewards[0]?.amount ?? 0 }));
  return { available: true, message: `Calculated from ${scheme.name}, version ${scheme.version}.`, schemeId: scheme.id, schemeName: scheme.name, schemeVersion: scheme.version, rewardUnit: scheme.rewardUnit, totalAmount: members.reduce((sum, member) => sum + member.amount, 0), members };
}

function getLocalSettlement(factionId: number, chainId: number): ChainSettlement | null {
  const database = openLocalDatabase();
  if (!database) return null;
  try {
    const row = database.prepare("SELECT * FROM chain_settlements WHERE faction_id = ? AND chain_id = ?").get(factionId, chainId) as unknown as LocalSettlementRow | undefined;
    return row ? mapLocalSettlement(row) : null;
  } catch { return null; } finally { database.close(); }
}

function mapLocalSettlement(row: LocalSettlementRow): ChainSettlement {
  const members = JSON.parse(row.snapshot_json) as ChainMemberReward[];
  return { available: true, message: `Saved payout snapshot from ${row.scheme_name}, version ${row.scheme_version}.`, factionId: row.faction_id, chainId: row.chain_id, status: row.status, schemeId: row.scheme_id, schemeName: row.scheme_name, schemeVersion: row.scheme_version, rewardUnit: row.reward_unit, totalAmount: row.total_amount, members, calculatedAt: row.calculated_at, paidAt: row.paid_at, paidByTornId: row.paid_by_torn_id };
}

function parseSettlement(value: unknown): ChainSettlement | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ChainSettlement>;
  if (typeof item.chainId !== "number" || typeof item.factionId !== "number" || (item.status !== "READY" && item.status !== "PAID") || !Array.isArray(item.members) || typeof item.totalAmount !== "number") return null;
  return item as ChainSettlement;
}

function settlementKey(chainId: number): string { return `chainSettlement.${chainId}`; }

interface LocalSettlementRow {
  faction_id: number;
  chain_id: number;
  status: "READY" | "PAID";
  scheme_id: string | null;
  scheme_name: string;
  scheme_version: number;
  reward_unit: string;
  total_amount: number;
  snapshot_json: string;
  calculated_at: string;
  paid_at: string | null;
  paid_by_torn_id: number | null;
}
