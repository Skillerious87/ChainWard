"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { planDuplicateSlots } from "@/lib/chain-watch/chain-watch-bulk";
import { findChainWatchConflicts } from "@/lib/chain-watch/chain-watch-conflicts";
import {
  createChainWatchSlotsBatch,
  deleteChainWatchSlotsBatch,
  getChainWatchWorkspace,
  swapChainWatchSlotPrimaries,
  type ChainWatchSlotInput,
} from "@/lib/chain-watch/chain-watch-store";
import type { ChainWatchActionResult } from "./actions";

const BULK_DELETE_LIMIT = 50;

const duplicateRangeSchema = z.object({
  rangeStartAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  rangeEndAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  offsetDays: z.union([z.literal(1), z.literal(7)]),
});

export interface SkippedDuplicate {
  primaryMemberName: string;
  startAt: string;
  endAt: string;
}

export async function duplicateChainWatchRangeAction(input: unknown): Promise<ChainWatchActionResult & { createdCount: number; skipped: SkippedDuplicate[] }> {
  try {
    const { actor, faction } = await requireFactionPermission("chain:manage");
    const parsed = duplicateRangeSchema.parse(input);
    const rangeStartMs = Date.parse(parsed.rangeStartAt);
    const rangeEndMs = Date.parse(parsed.rangeEndAt);
    if (!(rangeEndMs > rangeStartMs)) throw new Error("The range to duplicate must end after it starts.");

    const workspace = await getChainWatchWorkspace(faction.id);
    const offsetMs = parsed.offsetDays * 24 * 60 * 60 * 1_000;
    const planned = planDuplicateSlots(workspace.slots, rangeStartMs, rangeEndMs, offsetMs);
    if (planned.length === 0) return { ok: true, message: "Nothing in that range to duplicate.", createdCount: 0, skipped: [] };

    const bySourceId = new Map(workspace.slots.map((slot) => [slot.id, slot]));
    const accepted: ChainWatchSlotInput[] = [];
    const acceptedAsSlots: Array<{ id: string; startAt: string; endAt: string; primaryTornUserId: number; backupTornUserId: number | null }> = [];
    const skipped: SkippedDuplicate[] = [];

    planned.forEach((item, index) => {
      const source = bySourceId.get(item.sourceSlotId);
      if (!source) return;
      const candidate = { startAt: item.startAt, endAt: item.endAt, primaryTornUserId: source.primaryTornUserId, backupTornUserId: source.backupTornUserId };
      const conflicts = [
        ...findChainWatchConflicts(workspace.slots, candidate),
        ...findChainWatchConflicts(acceptedAsSlots, candidate),
      ];
      if (conflicts.length > 0) {
        skipped.push({ primaryMemberName: source.primaryMemberName, startAt: item.startAt, endAt: item.endAt });
        return;
      }
      acceptedAsSlots.push({ id: `pending-${index}`, ...candidate });
      accepted.push({
        startAt: item.startAt,
        endAt: item.endAt,
        primaryTornUserId: source.primaryTornUserId,
        primaryMemberName: source.primaryMemberName,
        backupTornUserId: source.backupTornUserId,
        backupMemberName: source.backupMemberName,
        note: source.note,
      });
    });

    if (accepted.length > 0) await createChainWatchSlotsBatch(faction.id, accepted, actor.tornUserId);
    revalidatePath("/chain-watch");
    const message = skipped.length > 0
      ? `${accepted.length} slot${accepted.length === 1 ? "" : "s"} duplicated, ${skipped.length} skipped due to a conflict.`
      : `${accepted.length} slot${accepted.length === 1 ? "" : "s"} duplicated.`;
    return { ok: true, message, createdCount: accepted.length, skipped };
  } catch (error) {
    return { ok: false, message: safeMessage(error), createdCount: 0, skipped: [] };
  }
}

const swapSchema = z.object({ slotIdA: z.string().uuid(), slotIdB: z.string().uuid() })
  .refine((value) => value.slotIdA !== value.slotIdB, { message: "Pick two different slots to swap." });

export async function swapChainWatchSlotMembersAction(input: unknown): Promise<ChainWatchActionResult> {
  try {
    const { slotIdA, slotIdB } = swapSchema.parse(input);
    const { faction } = await requireFactionPermission("chain:manage");
    const workspace = await getChainWatchWorkspace(faction.id);
    const slotA = workspace.slots.find((slot) => slot.id === slotIdA);
    const slotB = workspace.slots.find((slot) => slot.id === slotIdB);
    if (!slotA || !slotB) throw new Error("Both slots must still exist to swap them.");

    const otherSlots = workspace.slots.filter((slot) => slot.id !== slotIdA && slot.id !== slotIdB);
    const [conflictA] = findChainWatchConflicts(otherSlots, { startAt: slotA.startAt, endAt: slotA.endAt, primaryTornUserId: slotB.primaryTornUserId, backupTornUserId: slotA.backupTornUserId });
    if (conflictA) throw new Error(`Swapping would double-book ${slotB.primaryMemberName}.`);
    const [conflictB] = findChainWatchConflicts(otherSlots, { startAt: slotB.startAt, endAt: slotB.endAt, primaryTornUserId: slotA.primaryTornUserId, backupTornUserId: slotB.backupTornUserId });
    if (conflictB) throw new Error(`Swapping would double-book ${slotA.primaryMemberName}.`);

    await swapChainWatchSlotPrimaries(faction.id, slotIdA, slotIdB);
    revalidatePath("/chain-watch");
    return { ok: true, message: `Swapped ${slotA.primaryMemberName} and ${slotB.primaryMemberName}.` };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

const bulkDeleteSchema = z.object({ slotIds: z.array(z.string().uuid()).min(1).max(BULK_DELETE_LIMIT) });

export async function bulkDeleteChainWatchSlotsAction(input: unknown): Promise<ChainWatchActionResult & { deletedCount: number }> {
  try {
    const { slotIds } = bulkDeleteSchema.parse(input);
    const { faction } = await requireFactionPermission("chain:manage");
    const deletedCount = await deleteChainWatchSlotsBatch(faction.id, slotIds);
    revalidatePath("/chain-watch");
    return { ok: true, message: `${deletedCount} slot${deletedCount === 1 ? "" : "s"} removed.`, deletedCount };
  } catch (error) {
    return { ok: false, message: safeMessage(error), deletedCount: 0 };
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The bulk action could not be completed safely.";
}
