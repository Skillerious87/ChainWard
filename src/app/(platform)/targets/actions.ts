"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { fetchTargetSnapshot, refreshTargets } from "@/lib/targets/data-service";
import {
  addTargetEntry,
  mergeSnapshots,
  readTargetList,
  removeTargetEntry,
  setTargetNote,
  targetsStorageAvailable,
  writeTargetList,
} from "@/lib/targets/store";
import { parseTornUserId } from "@/lib/targets/types";

export interface TargetsActionResult {
  ok: boolean;
  message: string;
}

const addSchema = z.object({
  reference: z.string().trim().min(1).max(120),
  note: z.string().trim().max(280).optional(),
});
const removeSchema = z.object({ tornUserId: z.number().int().positive() });
const noteSchema = z.object({ tornUserId: z.number().int().positive(), note: z.string().trim().max(280) });

async function operatorContext() {
  const { actor } = await requireFactionPermission("faction:view");
  const connection = await getConfiguredTornConnection();
  if (!connection) throw new Error("Connect a verified Torn faction before building a target list.");
  if (!targetsStorageAvailable()) throw new Error("Create workspace storage in Settings before building a target list.");
  return {
    operatorId: actor.tornUserId,
    faction: { id: connection.factionId, name: connection.factionName ?? "", tag: connection.factionTag ?? "" },
    client: connection.client,
  };
}

export async function addTargetAction(input: unknown): Promise<TargetsActionResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a Torn player ID or profile link." };
  const tornUserId = parseTornUserId(parsed.data.reference);
  if (!tornUserId) return { ok: false, message: "That is not a recognisable Torn player ID or profile link." };

  try {
    const { operatorId, faction, client } = await operatorContext();
    if (tornUserId === operatorId) return { ok: false, message: "You cannot add yourself as a target." };

    const list = await readTargetList(faction.id, operatorId);
    let snapshot;
    try {
      snapshot = await fetchTargetSnapshot(client, tornUserId);
    } catch {
      return { ok: false, message: "Torn did not return a profile for that player. Check the ID and try again." };
    }

    const withEntry = addTargetEntry(list, {
      tornUserId,
      label: snapshot.name,
      note: parsed.data.note?.trim() ?? "",
      addedAt: new Date().toISOString(),
    });
    await writeTargetList(faction, operatorId, mergeSnapshots(withEntry, [snapshot]));
    revalidatePath("/targets");
    return { ok: true, message: `${snapshot.name || `Player ${tornUserId}`} was added to your target list.` };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function removeTargetAction(input: unknown): Promise<TargetsActionResult> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The target to remove was not identified." };
  try {
    const { operatorId, faction } = await operatorContext();
    const list = await readTargetList(faction.id, operatorId);
    if (!list.entries.some((entry) => entry.tornUserId === parsed.data.tornUserId)) {
      return { ok: false, message: "That player is not on your target list." };
    }
    await writeTargetList(faction, operatorId, removeTargetEntry(list, parsed.data.tornUserId));
    revalidatePath("/targets");
    return { ok: true, message: "Target removed." };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function updateTargetNoteAction(input: unknown): Promise<TargetsActionResult> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "A target note is limited to 280 characters." };
  try {
    const { operatorId, faction } = await operatorContext();
    const list = await readTargetList(faction.id, operatorId);
    if (!list.entries.some((entry) => entry.tornUserId === parsed.data.tornUserId)) {
      return { ok: false, message: "That player is not on your target list." };
    }
    await writeTargetList(faction, operatorId, setTargetNote(list, parsed.data.tornUserId, parsed.data.note));
    revalidatePath("/targets");
    return { ok: true, message: "Note saved." };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function refreshTargetsAction(): Promise<TargetsActionResult> {
  try {
    const { operatorId, faction } = await operatorContext();
    const list = await readTargetList(faction.id, operatorId);
    if (list.entries.length === 0) return { ok: true, message: "Your target list is empty." };

    const result = await refreshTargets(list.entries, list.snapshots, { force: true });
    if (result.snapshots.length > 0) {
      await writeTargetList(faction, operatorId, mergeSnapshots(list, result.snapshots));
    }
    revalidatePath("/targets");
    const failed = Object.keys(result.errors).length;
    return {
      ok: failed === 0,
      message: failed === 0
        ? `Refreshed ${result.snapshots.length} target${result.snapshots.length === 1 ? "" : "s"} from ${result.source}.`
        : `Refreshed ${result.snapshots.length}, but ${failed} target${failed === 1 ? "" : "s"} could not be read.`,
    };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The target list could not be updated safely.";
}
