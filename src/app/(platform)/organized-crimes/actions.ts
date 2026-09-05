"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { getOwnOcIntelDraft } from "@/lib/organized-crimes/data-service";
import {
  deleteMemberIntel,
  readMemberIntel,
  readOcSharePreference,
  saveMemberIntel,
  writeOcReviewSettings,
  writeOcSharePreference,
} from "@/lib/organized-crimes/store";
import { memberIntelSchema } from "@/lib/organized-crimes/types";

export interface OrganizedCrimesActionResult {
  ok: boolean;
  message: string;
}

const removeSchema = z.object({ tornUserId: z.number().int().positive() });
const settingsSchema = z.object({ minimumCpr: z.number().int().min(0).max(100) });
const autoShareSchema = z.object({ enabled: z.boolean() });

async function persistOwnDraft(faction: { id: number; name: string; tag: string }, tornUserId: number) {
  const result = await getOwnOcIntelDraft();
  if (!result.ok) return { ok: false as const, message: result.message, roleCount: 0 };
  const record = memberIntelSchema.parse({
    factionId: faction.id,
    tornUserId,
    stats: result.draft.stats,
    statsAt: result.draft.statsAt,
    roles: result.draft.roles,
    rolesMessage: result.draft.rolesMessage,
    source: result.draft.source,
  });
  await saveMemberIntel(faction, record);
  return { ok: true as const, message: "", roleCount: record.roles.length };
}

/**
 * The signed-in member opts in (or refreshes): their own key reads their own
 * battle stats and live OC checkpoint rates, which are then stored for the OC
 * leader to review. `requireFactionPermission` already guarantees the verified
 * Torn player matches this connection, so the shared record can only ever be
 * the actor's own.
 */
export async function shareOwnOcIntelAction(): Promise<OrganizedCrimesActionResult> {
  try {
    const { actor, faction } = await requireFactionPermission("faction:view");
    const outcome = await persistOwnDraft(faction, actor.tornUserId);
    if (!outcome.ok) return { ok: false, message: outcome.message };
    revalidatePath("/organized-crimes");
    return { ok: true, message: `Shared your battle stats and ${outcome.roleCount} live role rate${outcome.roleCount === 1 ? "" : "s"} with the OC leader.` };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

/** Re-pulls and overwrites the caller's shared record. Identical to sharing. */
export async function refreshOwnOcIntelAction(): Promise<OrganizedCrimesActionResult> {
  return shareOwnOcIntelAction();
}

/**
 * Fired by the client when auto-share is on and the last snapshot is stale.
 * Also stamps `lastAutoShareAt` so the client will not ask again for a while.
 */
export async function autoShareOwnOcIntelAction(): Promise<OrganizedCrimesActionResult> {
  try {
    const { actor, faction } = await requireFactionPermission("faction:view");
    const pref = await readOcSharePreference(faction.id, actor.tornUserId);
    if (!pref.autoShare) return { ok: false, message: "Automatic sharing is turned off." };

    const outcome = await persistOwnDraft(faction, actor.tornUserId);
    await writeOcSharePreference(faction, actor.tornUserId, { autoShare: true, lastAutoShareAt: new Date().toISOString() });
    revalidatePath("/organized-crimes");
    if (!outcome.ok) return { ok: false, message: outcome.message };
    return { ok: true, message: "Your shared stats were refreshed automatically." };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

/** Turn auto-share on or off. Turning it on shares immediately. */
export async function setOcAutoShareAction(input: unknown): Promise<OrganizedCrimesActionResult> {
  try {
    const { actor, faction } = await requireFactionPermission("faction:view");
    const parsed = autoShareSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "The automatic-sharing choice was invalid." };

    if (!parsed.data.enabled) {
      await writeOcSharePreference(faction, actor.tornUserId, { autoShare: false, lastAutoShareAt: null });
      revalidatePath("/organized-crimes");
      return { ok: true, message: "Automatic sharing is off. Your existing snapshot stays until you withdraw it." };
    }

    const outcome = await persistOwnDraft(faction, actor.tornUserId);
    await writeOcSharePreference(faction, actor.tornUserId, { autoShare: true, lastAutoShareAt: outcome.ok ? new Date().toISOString() : null });
    revalidatePath("/organized-crimes");
    if (!outcome.ok) return { ok: false, message: `Automatic sharing is on, but the first share failed: ${outcome.message}` };
    return { ok: true, message: "Automatic sharing is on. Your stats will refresh whenever you open this page and they're over 12 hours old." };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

/** Self-service consent withdrawal: removes the caller's own shared record and
 *  turns automatic sharing off so it does not come straight back. */
export async function withdrawOwnOcIntelAction(): Promise<OrganizedCrimesActionResult> {
  try {
    const { actor, faction } = await requireFactionPermission("faction:view");
    await deleteMemberIntel(faction.id, actor.tornUserId);
    await writeOcSharePreference(faction, actor.tornUserId, { autoShare: false, lastAutoShareAt: null });
    revalidatePath("/organized-crimes");
    return { ok: true, message: "Your shared OC data was removed and automatic sharing was turned off." };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

/** OC leader housekeeping: purge a stale or departed member's shared record. */
export async function removeMemberOcIntelAction(input: unknown): Promise<OrganizedCrimesActionResult> {
  try {
    const { faction } = await requireFactionPermission("oc:review");
    const parsed = removeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "The member to remove was not identified." };

    const existing = await readMemberIntel(faction.id, parsed.data.tornUserId);
    if (existing.length === 0) return { ok: false, message: "That member has not shared any OC data." };

    await deleteMemberIntel(faction.id, parsed.data.tornUserId);
    revalidatePath("/organized-crimes");
    return { ok: true, message: "Removed the member's shared OC data." };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function setOcReviewSettingsAction(input: unknown): Promise<OrganizedCrimesActionResult> {
  try {
    const { faction } = await requireFactionPermission("oc:review");
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "The checkpoint threshold must be a whole number between 0 and 100." };

    await writeOcReviewSettings(faction, { minimumCpr: parsed.data.minimumCpr });
    revalidatePath("/organized-crimes");
    return { ok: true, message: `Suggestions now require at least ${parsed.data.minimumCpr}% checkpoint pass rate.` };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The organized crimes workspace could not be updated safely.";
}
