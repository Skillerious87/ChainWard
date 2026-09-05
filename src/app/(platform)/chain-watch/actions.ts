"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { findChainWatchConflicts, type ChainWatchConflict } from "@/lib/chain-watch/chain-watch-conflicts";
import {
  createChainWatchSlot,
  deleteChainWatchSlot,
  getChainWatchWorkspace,
  updateChainWatchSlot,
  setChainWatchSettings,
  type ChainWatchSlot,
} from "@/lib/chain-watch/chain-watch-store";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

export interface ChainWatchActionResult {
  ok: boolean;
  message: string;
}

const settingsSchema = z.object({
  roleName: z.string().trim().min(1, "Give the duty a name.").max(40, "Keep the role name under 40 characters."),
  bufferSeconds: z.number().int().min(15, "The alert buffer needs at least 15 seconds.").max(280, "The buffer must stay below the 5-minute timeout."),
});

const MAX_SLOT_DURATION_MS = 24 * 60 * 60 * 1_000;

const slotSchema = z.object({
  startAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  endAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  primaryTornUserId: z.number().int().positive(),
  backupTornUserId: z.number().int().positive().nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
}).superRefine((value, context) => {
  const start = Date.parse(value.startAt);
  const end = Date.parse(value.endAt);
  if (!(end > start)) context.addIssue({ code: "custom", path: ["endAt"], message: "The slot must end after it starts." });
  else if (end - start > MAX_SLOT_DURATION_MS) context.addIssue({ code: "custom", path: ["endAt"], message: "A single slot can cover at most 24 hours." });
  if (value.backupTornUserId != null && value.backupTornUserId === value.primaryTornUserId) context.addIssue({ code: "custom", path: ["backupTornUserId"], message: "The backup must be a different member than the primary." });
});

export async function updateChainWatchSettingsAction(input: unknown): Promise<ChainWatchActionResult> {
  try {
    const { faction } = await requireFactionPermission("chain:manage");
    const parsed = settingsSchema.parse(input);
    await setChainWatchSettings(faction.id, parsed);
    revalidatePath("/chain-watch");
    return { ok: true, message: `Coverage duty is now called "${parsed.roleName}".` };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function createChainWatchSlotAction(input: unknown): Promise<ChainWatchActionResult & { slot?: ChainWatchSlot }> {
  try {
    const { actor, faction } = await requireFactionPermission("chain:manage");
    const parsed = slotSchema.parse(input);
    const resolved = await resolveSlotMembers(parsed);
    const workspace = await getChainWatchWorkspace(faction.id);
    const [conflict] = findChainWatchConflicts(workspace.slots, resolved);
    if (conflict) throw new Error(describeConflict(conflict, workspace.slots));
    const slot = await createChainWatchSlot(faction.id, resolved, actor.tornUserId);
    revalidatePath("/chain-watch");
    return { ok: true, message: `Coverage slot added for ${resolved.primaryMemberName}.`, slot };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function updateChainWatchSlotAction(input: unknown): Promise<ChainWatchActionResult & { slot?: ChainWatchSlot }> {
  try {
    const { slotId } = z.object({ slotId: z.string().uuid() }).parse(input);
    const parsed = slotSchema.parse(input);
    const { faction } = await requireFactionPermission("chain:manage");
    const resolved = await resolveSlotMembers(parsed);
    const workspace = await getChainWatchWorkspace(faction.id);
    const [conflict] = findChainWatchConflicts(workspace.slots, { ...resolved, excludeSlotId: slotId });
    if (conflict) throw new Error(describeConflict(conflict, workspace.slots));
    const slot = await updateChainWatchSlot(faction.id, slotId, resolved);
    revalidatePath("/chain-watch");
    return { ok: true, message: "Coverage slot updated.", slot };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function deleteChainWatchSlotAction(input: unknown): Promise<ChainWatchActionResult> {
  try {
    const { slotId } = z.object({ slotId: z.string().uuid() }).parse(input);
    const { faction } = await requireFactionPermission("chain:manage");
    await deleteChainWatchSlot(faction.id, slotId);
    revalidatePath("/chain-watch");
    return { ok: true, message: "Coverage slot removed." };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

/**
 * Member names are resolved from the verified roster server-side rather than
 * trusted from the client, matching how faction access assignments verify
 * their target. This also rejects a slot handed to someone no longer on the
 * faction.
 */
async function resolveSlotMembers(input: z.infer<typeof slotSchema>) {
  const roster = await getFactionRoster();
  if (!roster.available) throw new Error("The verified faction roster could not be read, so the schedule was not changed.");
  const primary = roster.data.find((member) => member.tornId === input.primaryTornUserId);
  if (!primary) throw new Error("The selected primary member is not in the current verified faction roster.");
  const backup = input.backupTornUserId != null ? roster.data.find((member) => member.tornId === input.backupTornUserId) : null;
  if (input.backupTornUserId != null && !backup) throw new Error("The selected backup member is not in the current verified faction roster.");
  return {
    startAt: input.startAt,
    endAt: input.endAt,
    primaryTornUserId: primary.tornId,
    primaryMemberName: primary.name,
    backupTornUserId: backup?.tornId ?? null,
    backupMemberName: backup?.name ?? null,
    note: input.note?.trim() || null,
  };
}

/** `findChainWatchConflicts` already did the real work; this only turns its first hit into a message naming who and when. */
function describeConflict(conflict: ChainWatchConflict, slots: readonly ChainWatchSlot[]): string {
  const existing = slots.find((slot) => slot.id === conflict.slotId);
  if (!existing) return "This assignment overlaps another scheduled slot for the same member.";
  const name = (conflict.existingRole === "primary" ? existing.primaryMemberName : existing.backupMemberName) ?? "This member";
  const role = conflict.existingRole === "backup" ? " as backup" : "";
  return `${name} is already scheduled${role} from ${formatConflictTime(existing.startAt)} to ${formatConflictTime(existing.endAt)} TCT.`;
}

function formatConflictTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso));
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The chain watch schedule could not be updated safely.";
}
