"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { AWARD_CITATION_MAX, AWARD_CITATION_MIN, isMemberBadgeId } from "@/lib/members/member-badges";
import { setMemberActivity, setMemberActivityPolicy } from "@/lib/members/member-activity-store";
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
