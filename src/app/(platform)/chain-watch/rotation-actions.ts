"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import {
  createChainWatchRotation,
  deleteChainWatchRotation,
  ensureRotationsMaterialized,
  pauseChainWatchRotation,
  updateChainWatchRotation,
  type ChainWatchRotation,
  type ChainWatchRotationInput,
} from "@/lib/chain-watch/chain-watch-rotation-store";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";
import type { ChainWatchActionResult } from "./actions";

const rotationMemberSchema = z.object({
  tornUserId: z.number().int().positive(),
  memberName: z.string().trim().min(1).max(50),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");

const rotationSchema = z.object({
  label: z.string().trim().min(1, "Give the rotation a name.").max(60, "Keep the name under 60 characters."),
  weekdaysMask: z.number().int().min(1, "Select at least one day.").max(127),
  startMinuteUtc: z.number().int().min(0).max(1439),
  endMinuteUtc: z.number().int().min(0).max(1439),
  members: z.array(rotationMemberSchema).min(1, "Add at least one member to rotate.").max(20, "A rotation can include at most 20 members."),
  backupTornUserId: z.number().int().positive().nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
  effectiveFrom: isoDate,
  effectiveUntil: isoDate.nullable().optional(),
}).superRefine((value, context) => {
  if (value.startMinuteUtc === value.endMinuteUtc) context.addIssue({ code: "custom", path: ["endMinuteUtc"], message: "Start and end time cannot be identical." });
  if (value.effectiveUntil && value.effectiveUntil < value.effectiveFrom) context.addIssue({ code: "custom", path: ["effectiveUntil"], message: "The end date must be on or after the start date." });
  if (value.backupTornUserId != null && value.members.some((member) => member.tornUserId === value.backupTornUserId)) {
    context.addIssue({ code: "custom", path: ["backupTornUserId"], message: "The backup cannot also be in the rotating member list -- on that member's day they would double as their own backup." });
  }
});

export async function createChainWatchRotationAction(input: unknown): Promise<ChainWatchActionResult & { rotation?: ChainWatchRotation }> {
  try {
    const { actor, faction } = await requireFactionPermission("chain:manage");
    const parsed = rotationSchema.parse(input);
    const resolved = await resolveRotationMembers(parsed);
    const rotation = await createChainWatchRotation(faction.id, resolved, actor.tornUserId);
    await ensureRotationsMaterialized(faction.id);
    revalidatePath("/chain-watch");
    return { ok: true, message: `"${rotation.label}" rotation created.`, rotation };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function updateChainWatchRotationAction(input: unknown): Promise<ChainWatchActionResult & { rotation?: ChainWatchRotation; manuallyAdjustedCount?: number }> {
  try {
    const { rotationId } = z.object({ rotationId: z.string().uuid() }).parse(input);
    const parsed = rotationSchema.parse(input);
    const { faction } = await requireFactionPermission("chain:manage");
    const resolved = await resolveRotationMembers(parsed);
    const { rotation, manuallyAdjustedCount } = await updateChainWatchRotation(faction.id, rotationId, resolved);
    await ensureRotationsMaterialized(faction.id);
    revalidatePath("/chain-watch");
    return { ok: true, message: "Rotation updated.", rotation, manuallyAdjustedCount };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function deleteChainWatchRotationAction(input: unknown): Promise<ChainWatchActionResult> {
  try {
    const { rotationId } = z.object({ rotationId: z.string().uuid() }).parse(input);
    const { faction } = await requireFactionPermission("chain:manage");
    await deleteChainWatchRotation(faction.id, rotationId);
    revalidatePath("/chain-watch");
    return { ok: true, message: "Rotation removed." };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function pauseChainWatchRotationAction(input: unknown): Promise<ChainWatchActionResult> {
  try {
    const { rotationId, isPaused } = z.object({ rotationId: z.string().uuid(), isPaused: z.boolean() }).parse(input);
    const { faction } = await requireFactionPermission("chain:manage");
    await pauseChainWatchRotation(faction.id, rotationId, isPaused);
    revalidatePath("/chain-watch");
    return { ok: true, message: isPaused ? "Rotation paused." : "Rotation resumed." };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

/** Members and the backup are resolved from the verified roster server-side, matching `resolveSlotMembers` in `actions.ts` -- never trusted from the client. */
async function resolveRotationMembers(input: z.infer<typeof rotationSchema>): Promise<ChainWatchRotationInput> {
  const roster = await getFactionRoster();
  if (!roster.available) throw new Error("The verified faction roster could not be read, so the rotation was not saved.");
  const members = input.members.map((member) => {
    const match = roster.data.find((candidate) => candidate.tornId === member.tornUserId);
    if (!match) throw new Error(`${member.memberName || "A selected member"} is not in the current verified faction roster.`);
    return { tornUserId: match.tornId, memberName: match.name };
  });
  const backup = input.backupTornUserId != null ? roster.data.find((candidate) => candidate.tornId === input.backupTornUserId) : null;
  if (input.backupTornUserId != null && !backup) throw new Error("The selected backup member is not in the current verified faction roster.");
  return {
    label: input.label,
    weekdaysMask: input.weekdaysMask,
    startMinuteUtc: input.startMinuteUtc,
    endMinuteUtc: input.endMinuteUtc,
    members,
    backupTornUserId: backup?.tornId ?? null,
    backupMemberName: backup?.name ?? null,
    note: input.note?.trim() || null,
    effectiveFrom: dateOnlyToIso(input.effectiveFrom),
    effectiveUntil: input.effectiveUntil ? dateOnlyToIso(input.effectiveUntil) : null,
  };
}

function dateOnlyToIso(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The rotation could not be saved safely.";
}
