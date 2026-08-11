"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { calculateChainRewardPreview, getChainSettlement, revertChainSettlement, savePaidChainSettlement, settlementFromPreview } from "@/lib/rewards/chain-settlement";
import { getRewardWorkspace } from "@/lib/rewards/reward-store";
import { getChainReportView } from "@/lib/torn/workspace-data-service";

export async function markChainPaid(input: unknown): Promise<{ chainId: number; paidAt: string; totalAmount: number; rewardUnit: string }> {
  const { chainId } = z.object({ chainId: z.number().int().positive() }).parse(input);
  const { actor, faction } = await requireFactionPermission("payout:manage");
  const existing = await getChainSettlement(faction.id, chainId);
  if (existing?.status === "PAID") return { chainId, paidAt: existing.paidAt ?? existing.calculatedAt, totalAmount: existing.totalAmount, rewardUnit: existing.rewardUnit ?? "units" };
  const [reportResult, workspace] = await Promise.all([getChainReportView(chainId), getRewardWorkspace(faction.id)]);
  if (!reportResult.data) throw new Error(reportResult.message);
  if (reportResult.data.factionId !== faction.id) throw new Error("The chain report does not belong to the connected faction.");
  const preview = calculateChainRewardPreview(reportResult.data, workspace);
  const settlement = settlementFromPreview(preview, faction.id, chainId, actor.tornUserId);
  await savePaidChainSettlement(settlement, reportResult.data, actor.name);
  revalidatePath("/chains");
  revalidatePath(`/chains/${chainId}`);
  return { chainId, paidAt: settlement.paidAt!, totalAmount: settlement.totalAmount, rewardUnit: settlement.rewardUnit! };
}

/**
 * Returns a chain to its unpaid state. Marking a chain paid asserts that the
 * rewards were sent, and that assertion can be made in error, so the operator
 * who can record a payment can also withdraw one.
 */
export async function revertChainPayment(input: unknown): Promise<{ chainId: number }> {
  const { chainId } = z.object({ chainId: z.number().int().positive() }).parse(input);
  const { faction } = await requireFactionPermission("payout:manage");
  const existing = await getChainSettlement(faction.id, chainId);
  if (!existing || existing.status !== "PAID") throw new Error("This chain is not currently marked as paid.");
  await revertChainSettlement(faction.id, chainId);
  revalidatePath("/chains");
  revalidatePath(`/chains/${chainId}`);
  revalidatePath("/payouts");
  return { chainId };
}
