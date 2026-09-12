"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { calculateChainRewardPreview, clearPendingPayoutRevertRequest, getChainSettlement, getPendingPayoutRevertRequest, revertChainSettlement, savePaidChainSettlement, savePendingPayoutRevertRequest, settlementFromPreview } from "@/lib/rewards/chain-settlement";
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
 * who can record a payment can also withdraw one — but a withdrawal retracts
 * that assertion, so it is treated as a high-risk action requiring a second,
 * different operator's confirmation rather than applying immediately:
 *
 * - No pending request for this chain yet -> this call records one and
 *   returns "requested" without touching the settlement.
 * - A pending request exists from a *different* operator -> this call
 *   confirms it, applies the revert, and clears the request.
 * - A pending request exists from the *same* operator -> refused; the point
 *   of the second step is that it cannot be the same person.
 */
export async function revertChainPayment(input: unknown): Promise<{ chainId: number; status: "requested" | "reverted" }> {
  // A stated reason is required: a withdrawal that leaves no explanation is
  // indistinguishable from tampering when the ledger is reviewed later.
  const { chainId, reason } = z.object({
    chainId: z.number().int().positive(),
    reason: z.string().trim().min(8, "Describe why this payout is being withdrawn.").max(300),
  }).parse(input);
  const { actor, faction } = await requireFactionPermission("payout:manage");
  const existing = await getChainSettlement(faction.id, chainId);
  if (!existing || existing.status !== "PAID") throw new Error("This chain is not currently marked as paid.");

  const pending = await getPendingPayoutRevertRequest(faction.id, chainId);
  if (!pending) {
    await savePendingPayoutRevertRequest(faction.id, chainId, { reason, requestedByTornId: actor.tornUserId, requestedByName: actor.name, requestedAt: new Date().toISOString() });
    revalidatePath(`/chains/${chainId}`);
    return { chainId, status: "requested" };
  }
  if (pending.requestedByTornId === actor.tornUserId) {
    throw new Error("You already requested this withdrawal. A different administrator must confirm it before the chain returns to unpaid.");
  }

  await revertChainSettlement(faction.id, chainId, {
    reason: `Requested by ${pending.requestedByName}: ${pending.reason} — confirmed by ${actor.name}: ${reason}`,
    totalAmount: existing.totalAmount,
    rewardUnit: existing.rewardUnit,
    revertedAt: new Date().toISOString(),
    revertedByTornId: actor.tornUserId,
    revertedByName: actor.name,
  });
  await clearPendingPayoutRevertRequest(faction.id, chainId);
  revalidatePath("/chains");
  revalidatePath(`/chains/${chainId}`);
  revalidatePath("/payouts");
  return { chainId, status: "reverted" };
}

/** Withdraws a payout-revert request before a second operator confirms it. */
export async function cancelChainPaymentRevertRequest(input: unknown): Promise<{ chainId: number }> {
  const { chainId } = z.object({ chainId: z.number().int().positive() }).parse(input);
  const { actor, faction } = await requireFactionPermission("payout:manage");
  const pending = await getPendingPayoutRevertRequest(faction.id, chainId);
  if (!pending) return { chainId };
  if (pending.requestedByTornId !== actor.tornUserId) throw new Error("Only the administrator who requested this withdrawal can cancel it.");
  await clearPendingPayoutRevertRequest(faction.id, chainId);
  revalidatePath(`/chains/${chainId}`);
  return { chainId };
}
