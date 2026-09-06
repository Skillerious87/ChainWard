"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { AWARD_CITATION_MAX, AWARD_CITATION_MIN, isMemberBadgeId } from "@/lib/members/member-badges";
import { setMemberActivity, setMemberActivityPolicy } from "@/lib/members/member-activity-store";
import { AUTO_SHARE_STALE_MS } from "@/lib/members/member-battle-stats";
import { getOwnBattleStatsDraft } from "@/lib/members/member-battle-stats-data";
import {
  deleteMemberBattleStats,
  readBattleStatsSharePreference,
  readMemberBattleStats,
  saveMemberBattleStats,
  writeBattleStatsSharePreference,
} from "@/lib/members/member-battle-stats-store";
import { memberBattleStatsSchema } from "@/lib/members/member-battle-stats";
import { assignMemberAward, createMemberReport, revokeMemberAward } from "@/lib/members/member-profile-store";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

const activitySchema = z.object({
  factionId: z.number().int().positive(),
  tornUserId: z.number().int().positive(),
  state: z.enum(["STANDARD", "HOLIDAY", "WATCH"]),
  holidayUntil: z.string().datetime().nullable(),
  note: z.string().trim().max(500),
});

const policySchema = z.object({
  factionId: z.number().int().positive(),
  thresholdDays: z.number().int().min(1).max(30),
});

const memberRecordTargetSchema = z.object({
  factionId: z.number().int().positive(),
  tornUserId: z.number().int().positive(),
});

const reportSchema = memberRecordTargetSchema.extend({
  category: z.enum(["RECOGNITION", "DEVELOPMENT", "INCIDENT", "GENERAL"]),
  visibility: z.enum(["FACTION", "LEADERSHIP"]),
  title: z.string().trim().min(3).max(80),
  body: z.string().trim().min(10).max(1500),
});

const awardSchema = memberRecordTargetSchema.extend({
  badgeId: z.string().refine(isMemberBadgeId),
  citation: z.string().trim().min(AWARD_CITATION_MIN).max(AWARD_CITATION_MAX),
});

const revokeAwardSchema = memberRecordTargetSchema.extend({
  awardId: z.string().uuid(),
  reason: z.string().trim().min(3).max(240),
});

export interface MemberActivityActionResult { ok: boolean; message: string }

export async function addMemberReport(input: unknown): Promise<MemberActivityActionResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Add a title, a report of at least 10 characters, and a valid visibility." };
  try {
    const context = await requireMemberManager(parsed.data.factionId, parsed.data.tornUserId);
    await createMemberReport(context.faction, context.member, context.actor, parsed.data);
    revalidateMemberRecord(parsed.data.tornUserId);
    return { ok: true, message: `${context.member.memberName}'s report was added to the permanent record.` };
  } catch (error) {
    return { ok: false, message: actionError(error, "The member report could not be saved safely.") };
  }
}

export async function addMemberAward(input: unknown): Promise<MemberActivityActionResult> {
  const parsed = awardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a badge and add a short citation explaining why it was awarded." };
  try {
    const context = await requireMemberManager(parsed.data.factionId, parsed.data.tornUserId);
    await assignMemberAward(context.faction, context.member, context.actor, parsed.data);
    revalidateMemberRecord(parsed.data.tornUserId);
    return { ok: true, message: `${context.member.memberName}'s badge is now displayed on their Chainward report.` };
  } catch (error) {
    return { ok: false, message: actionError(error, "The member badge could not be assigned safely.") };
  }
}

export async function removeMemberAward(input: unknown): Promise<MemberActivityActionResult> {
  const parsed = revokeAwardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Add a short reason before revoking this badge." };
  try {
    const context = await requireMemberManager(parsed.data.factionId, parsed.data.tornUserId);
    await revokeMemberAward(context.faction, context.member, context.actor, parsed.data.awardId, parsed.data.reason);
    revalidateMemberRecord(parsed.data.tornUserId);
    return { ok: true, message: `The badge was removed from ${context.member.memberName}'s active awards and retained in the audit history.` };
  } catch (error) {
    return { ok: false, message: actionError(error, "The member badge could not be revoked safely.") };
  }
}

export async function updateMemberActivity(input: unknown): Promise<MemberActivityActionResult> {
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The member activity update was incomplete or invalid." };
  try {
    const { actor, faction } = await requireFactionPermission("members:manage");
    if (faction.id !== parsed.data.factionId) throw new Error("The selected member belongs to a different faction workspace.");
    if (parsed.data.state === "HOLIDAY" && parsed.data.holidayUntil && Date.parse(parsed.data.holidayUntil) <= Date.now()) throw new Error("Choose a future holiday end date or leave it open-ended.");
    const roster = await getFactionRoster();
    const member = roster.available ? roster.data.find((item) => item.tornId === parsed.data.tornUserId) : null;
    if (!member) throw new Error("The selected player is not in the current verified faction roster.");
    await setMemberActivity(
      { id: faction.id, name: faction.name, tag: faction.tag },
      { tornUserId: member.tornId, memberName: member.name },
      actor,
      parsed.data,
    );
    revalidatePath("/members");
    const message = parsed.data.state === "HOLIDAY"
      ? `${member.name} is exempt from inactivity attention${parsed.data.holidayUntil ? " until the selected return date" : " until the holiday is cleared"}.`
      : parsed.data.state === "WATCH"
        ? `${member.name} is on the activity watch list.`
        : `${member.name} now follows the standard activity policy.`;
    return { ok: true, message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The member activity record could not be updated safely." };
  }
}

export async function updateMemberActivityPolicy(input: unknown): Promise<MemberActivityActionResult> {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose an inactivity threshold between 1 and 30 days." };
  try {
    const { actor, faction } = await requireFactionPermission("members:manage");
    if (faction.id !== parsed.data.factionId) throw new Error("The selected policy belongs to a different faction workspace.");
    await setMemberActivityPolicy({ id: faction.id, name: faction.name, tag: faction.tag }, actor, parsed.data.thresholdDays);
    revalidatePath("/members");
    revalidatePath("/", "layout");
    return { ok: true, message: `Owners will now be alerted after ${parsed.data.thresholdDays} inactive day${parsed.data.thresholdDays === 1 ? "" : "s"}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The faction activity policy could not be updated safely." };
  }
}

async function requireMemberManager(factionId: number, tornUserId: number) {
  const { actor, faction } = await requireFactionPermission("members:manage");
  if (faction.id !== factionId) throw new Error("The selected member belongs to a different faction workspace.");
  const roster = await getFactionRoster();
  const member = roster.available ? roster.data.find((item) => item.tornId === tornUserId) : null;
  if (!member) throw new Error("The selected player is not in the current verified faction roster.");
  return {
    actor,
    faction: { id: faction.id, name: faction.name, tag: faction.tag },
    member: { tornUserId: member.tornId, memberName: member.name },
  };
}

function revalidateMemberRecord(tornUserId: number): void {
  revalidatePath("/members");
  revalidatePath(`/members/${tornUserId}`);
}

function actionError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/* ------------------------------------------------------------ battle stats */

const battleStatsAutoShareSchema = z.object({ enabled: z.boolean() });
const removeBattleStatsSchema = z.object({ tornUserId: z.number().int().positive() });

async function persistOwnBattleStats(faction: { id: number; name: string; tag: string }, tornUserId: number) {
  const result = await getOwnBattleStatsDraft();
  if (!result.ok) return { ok: false as const, message: result.message };
  const record = memberBattleStatsSchema.parse({
    factionId: faction.id,
    tornUserId,
    stats: result.draft.stats,
    statsAt: result.draft.statsAt,
    source: result.draft.source,
  });
  await saveMemberBattleStats(faction, record);
  return { ok: true as const, message: "" };
}

/**
 * The signed-in member opts in (or refreshes): their own key reads their own
 * battle stats, which are then stored for faction leadership to review.
 * `requireFactionPermission` already guarantees the verified Torn player matches
 * this connection, so the shared record can only ever be the actor's own.
 */
export async function shareOwnBattleStatsAction(): Promise<MemberActivityActionResult> {
  try {
    const { actor, faction } = await requireFactionPermission("faction:view");
    const outcome = await persistOwnBattleStats(faction, actor.tornUserId);
    if (!outcome.ok) return { ok: false, message: outcome.message };
    revalidateBattleStats(actor.tornUserId);
    return { ok: true, message: "Your battle stats were shared with faction leadership." };
  } catch (error) {
    return { ok: false, message: actionError(error, "Your battle stats could not be shared safely.") };
  }
}

/** Re-pulls and overwrites the caller's shared record. Identical to sharing. */
export async function refreshOwnBattleStatsAction(): Promise<MemberActivityActionResult> {
  return shareOwnBattleStatsAction();
}

/**
 * Fired by the client when auto-share is on and the last snapshot is stale.
 * Also stamps `lastAutoShareAt` so the client will not ask again for a while.
 */
export async function autoShareOwnBattleStatsAction(): Promise<MemberActivityActionResult> {
  try {
    const { actor, faction } = await requireFactionPermission("faction:view");
    const pref = await readBattleStatsSharePreference(faction.id, actor.tornUserId);
    if (!pref.autoShare) return { ok: false, message: "Automatic sharing is turned off." };

    const outcome = await persistOwnBattleStats(faction, actor.tornUserId);
    await writeBattleStatsSharePreference(faction, actor.tornUserId, { autoShare: true, lastAutoShareAt: new Date().toISOString() });
    revalidateBattleStats(actor.tornUserId);
    if (!outcome.ok) return { ok: false, message: outcome.message };
    return { ok: true, message: "Your shared battle stats were refreshed automatically." };
  } catch (error) {
    return { ok: false, message: actionError(error, "Automatic sharing could not run safely.") };
  }
}

/** Turn auto-share on or off. Turning it on shares immediately. */
export async function setBattleStatsAutoShareAction(input: unknown): Promise<MemberActivityActionResult> {
  const parsed = battleStatsAutoShareSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The automatic-sharing choice was invalid." };
  try {
    const { actor, faction } = await requireFactionPermission("faction:view");
    if (!parsed.data.enabled) {
      await writeBattleStatsSharePreference(faction, actor.tornUserId, { autoShare: false, lastAutoShareAt: null });
      revalidateBattleStats(actor.tornUserId);
      return { ok: true, message: "Automatic sharing is off. Your existing snapshot stays until you withdraw it." };
    }

    const outcome = await persistOwnBattleStats(faction, actor.tornUserId);
    await writeBattleStatsSharePreference(faction, actor.tornUserId, { autoShare: true, lastAutoShareAt: outcome.ok ? new Date().toISOString() : null });
    revalidateBattleStats(actor.tornUserId);
    if (!outcome.ok) return { ok: false, message: `Automatic sharing is on, but the first share failed: ${outcome.message}` };
    return { ok: true, message: `Automatic sharing is on. Your stats refresh whenever you open this page and they're over ${Math.round(AUTO_SHARE_STALE_MS / 3_600_000)} hours old.` };
  } catch (error) {
    return { ok: false, message: actionError(error, "Automatic sharing could not be changed safely.") };
  }
}

/** Self-service consent withdrawal: removes the caller's own shared record and
 *  turns automatic sharing off so it does not come straight back. */
export async function withdrawOwnBattleStatsAction(): Promise<MemberActivityActionResult> {
  try {
    const { actor, faction } = await requireFactionPermission("faction:view");
    await deleteMemberBattleStats(faction.id, actor.tornUserId);
    await writeBattleStatsSharePreference(faction, actor.tornUserId, { autoShare: false, lastAutoShareAt: null });
    revalidateBattleStats(actor.tornUserId);
    return { ok: true, message: "Your shared battle stats were removed and automatic sharing was turned off." };
  } catch (error) {
    return { ok: false, message: actionError(error, "Your shared battle stats could not be removed safely.") };
  }
}

/** Leadership housekeeping: purge a stale or departed member's shared record. */
export async function removeMemberBattleStatsAction(input: unknown): Promise<MemberActivityActionResult> {
  const parsed = removeBattleStatsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The member to remove was not identified." };
  try {
    const { faction } = await requireFactionPermission("members:manage");
    const existing = await readMemberBattleStats(faction.id, parsed.data.tornUserId);
    if (existing.length === 0) return { ok: false, message: "That member has not shared any battle stats." };
    await deleteMemberBattleStats(faction.id, parsed.data.tornUserId);
    revalidateBattleStats(parsed.data.tornUserId);
    return { ok: true, message: "Removed the member's shared battle stats." };
  } catch (error) {
    return { ok: false, message: actionError(error, "The shared battle stats could not be removed safely.") };
  }
}

function revalidateBattleStats(tornUserId: number): void {
  revalidatePath("/members");
  revalidatePath(`/members/${tornUserId}`);
}
