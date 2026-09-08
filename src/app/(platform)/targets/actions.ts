"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { consumePartitionRateLimit } from "@/lib/security/rate-limit";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { fetchTargetSnapshot, fetchTargetSnapshots, loadHitIndex, refreshTargets, snapshotFromFactionMember } from "@/lib/targets/data-service";
import { clearFfscouterKey, saveFfscouterKey } from "@/lib/targets/ffscouter-key-store";
import {
  addTargetEntries,
  addTargetEntry,
  mergeSnapshots,
  readTargetList,
  removeTargetEntry,
  setTargetNote,
  setTargetPinned,
  setTargetTags,
  targetAddError,
  targetsStorageAvailable,
  writeTargetList,
} from "@/lib/targets/store";
import {
  MAX_TAGS_PER_TARGET,
  MAX_TARGETS,
  normaliseTag,
  parseTornUserId,
  parseTornUserIdList,
  type TargetEntry,
} from "@/lib/targets/types";

export interface TargetsActionResult {
  ok: boolean;
  message: string;
}

const addSchema = z.object({
  reference: z.string().trim().min(1).max(120),
  note: z.string().trim().max(280).optional(),
});
const importSchema = z.object({ text: z.string().trim().min(1).max(4_000) });
const removeSchema = z.object({ tornUserId: z.number().int().positive() });
const noteSchema = z.object({ tornUserId: z.number().int().positive(), note: z.string().trim().max(280) });
const pinnedSchema = z.object({ tornUserId: z.number().int().positive(), pinned: z.boolean() });
const tagsSchema = z.object({ tornUserId: z.number().int().positive(), tags: z.array(z.string().max(40)).max(MAX_TAGS_PER_TARGET) });

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
    const addError = targetAddError(list, tornUserId);
    if (addError) return { ok: false, message: addError };

    const hitIndex = await loadHitIndex(client, operatorId);
    let snapshot;
    try {
      snapshot = await fetchTargetSnapshot(client, tornUserId, hitIndex.get(tornUserId));
    } catch {
      return { ok: false, message: "Torn did not return a profile for that player. Check the ID and try again." };
    }

    const withEntry = addTargetEntry(list, {
      tornUserId,
      label: snapshot.name,
      note: parsed.data.note?.trim() ?? "",
      pinned: false,
      tags: [],
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

export async function importTargetsAction(input: unknown): Promise<TargetsActionResult> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Paste some Torn player IDs or profile links first." };
  const ids = parseTornUserIdList(parsed.data.text);
  if (ids.length === 0) return { ok: false, message: "No recognisable Torn player IDs or profile links were found." };

  try {
    const { operatorId, faction, client } = await operatorContext();
    const wanted = ids.filter((id) => id !== operatorId).slice(0, 100);
    const list = await readTargetList(faction.id, operatorId);
    const known = new Set(list.entries.map((entry) => entry.tornUserId));
    const toFetch = wanted.filter((id) => !known.has(id));
    const alreadyListed = wanted.length - toFetch.length;

    const hitIndex = await loadHitIndex(client, operatorId);
    const { snapshots, errors } = await fetchTargetSnapshots(client, toFetch, hitIndex, operatorId);
    const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.tornUserId, snapshot]));
    const newEntries: TargetEntry[] = toFetch
      .filter((id) => snapshotById.has(id))
      .map((id) => ({ tornUserId: id, label: snapshotById.get(id)!.name, note: "", pinned: false, tags: [], addedAt: new Date().toISOString() }));

    const { list: withEntries, added, skipped, capped } = addTargetEntries(list, newEntries);
    if (added > 0) await writeTargetList(faction, operatorId, mergeSnapshots(withEntries, snapshots));
    revalidatePath("/targets");

    const failed = Object.keys(errors).length;
    const parts = [`Added ${added}`];
    if (skipped + alreadyListed > 0) parts.push(`${skipped + alreadyListed} already listed`);
    if (failed > 0) parts.push(`${failed} not found`);
    if (capped > 0) parts.push(`${capped} over the ${MAX_TARGETS}-target cap`);
    return { ok: added > 0, message: `${parts.join(", ")}.` };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

const importFactionSchema = z.object({ factionId: z.number().int().positive() });

/**
 * Bulk-adds an entire (arbitrary) Torn faction's current roster as targets —
 * exactly two Torn calls regardless of roster size, since every added member
 * is snapshotted straight from the roster read (see snapshotFromFactionMember)
 * rather than fetched individually; the next ordinary refresh backfills real
 * life/status/bounty data for each of them through the normal bounded path.
 */
export async function importFactionTargetsAction(input: unknown): Promise<TargetsActionResult> {
  const parsed = importFactionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a numeric Torn faction ID." };

  try {
    const { operatorId, faction, client } = await operatorContext();
    if (parsed.data.factionId === faction.id) return { ok: false, message: "That is your own faction." };
    const limit = consumePartitionRateLimit("targets-import-faction:actor", operatorId, { limit: 5, windowMs: 60_000 });
    if (!limit.allowed) return { ok: false, message: `You're importing factions too often. Try again in ${limit.retryAfterSeconds}s.` };

    const [basic, roster] = await Promise.all([
      client.getFactionBasic(parsed.data.factionId),
      client.getFactionMembers(parsed.data.factionId),
    ]);
    const fetchedAtMs = Date.now();
    const list = await readTargetList(faction.id, operatorId);
    const known = new Set(list.entries.map((entry) => entry.tornUserId));
    const members = roster.members.filter((member) => member.id !== operatorId && !known.has(member.id));

    const newEntries: TargetEntry[] = members.map((member) => ({ tornUserId: member.id, label: member.name, note: "", pinned: false, tags: [], addedAt: new Date().toISOString() }));
    const snapshots = members.map((member) => snapshotFromFactionMember(basic.basic.id, basic.basic.name, member, fetchedAtMs));

    const { list: withEntries, added, skipped, capped } = addTargetEntries(list, newEntries);
    if (added > 0) await writeTargetList(faction, operatorId, mergeSnapshots(withEntries, snapshots));
    revalidatePath("/targets");

    const alreadyListed = roster.members.length - members.length;
    const parts = [`Added ${added} from ${basic.basic.name}`];
    if (skipped + alreadyListed > 0) parts.push(`${skipped + alreadyListed} already listed`);
    if (capped > 0) parts.push(`${capped} over the ${MAX_TARGETS}-target cap`);
    return { ok: added > 0, message: `${parts.join(", ")}.` };
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

export async function setTargetPinnedAction(input: unknown): Promise<TargetsActionResult> {
  const parsed = pinnedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The target to pin was not identified." };
  try {
    const { operatorId, faction } = await operatorContext();
    const list = await readTargetList(faction.id, operatorId);
    if (!list.entries.some((entry) => entry.tornUserId === parsed.data.tornUserId)) {
      return { ok: false, message: "That player is not on your target list." };
    }
    await writeTargetList(faction, operatorId, setTargetPinned(list, parsed.data.tornUserId, parsed.data.pinned));
    revalidatePath("/targets");
    return { ok: true, message: parsed.data.pinned ? "Pinned to the top." : "Unpinned." };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function setTargetTagsAction(input: unknown): Promise<TargetsActionResult> {
  const parsed = tagsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: `Use up to ${MAX_TAGS_PER_TARGET} short tags.` };
  const tags = [...new Set(parsed.data.tags.map(normaliseTag).filter((tag): tag is string => tag !== null))].slice(0, MAX_TAGS_PER_TARGET);
  try {
    const { operatorId, faction } = await operatorContext();
    const list = await readTargetList(faction.id, operatorId);
    if (!list.entries.some((entry) => entry.tornUserId === parsed.data.tornUserId)) {
      return { ok: false, message: "That player is not on your target list." };
    }
    await writeTargetList(faction, operatorId, setTargetTags(list, parsed.data.tornUserId, tags));
    revalidatePath("/targets");
    return { ok: true, message: "Tags saved." };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function refreshTargetsAction(): Promise<TargetsActionResult> {
  try {
    const { operatorId, faction } = await operatorContext();
    // Shares its bucket with the GET /api/targets/refresh poll (same scope
    // string, same cost) so alternating between the two can't double the
    // effective budget of forced, up-to-40-target Torn refreshes per minute.
    const limit = consumePartitionRateLimit("targets-refresh:actor", operatorId, { limit: 30, windowMs: 60_000 });
    if (!limit.allowed) return { ok: false, message: `You're refreshing too often. Try again in ${limit.retryAfterSeconds}s.` };

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

const ffscouterKeySchema = z.object({ apiKey: z.string().trim().min(1).max(64) });

/** ffscouter.com — an independent, free Fair Fight estimation service. This
 *  key is unrelated to the operator's Torn API key. */
export async function saveFfscouterKeyAction(input: unknown): Promise<TargetsActionResult> {
  const parsed = ffscouterKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter your FFScouter API key." };
  try {
    const { operatorId, faction } = await operatorContext();
    const lastFour = await saveFfscouterKey(faction, operatorId, parsed.data.apiKey);
    revalidatePath("/targets");
    return { ok: true, message: `FFScouter key saved (ending ${lastFour}). Fair Fight estimates will appear on the next refresh.` };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function removeFfscouterKeyAction(): Promise<TargetsActionResult> {
  try {
    const { operatorId, faction } = await operatorContext();
    await clearFfscouterKey(faction, operatorId);
    revalidatePath("/targets");
    return { ok: true, message: "FFScouter key removed. Fair Fight estimates are hidden until you add one again." };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The target list could not be updated safely.";
}
