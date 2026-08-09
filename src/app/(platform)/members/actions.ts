"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { setMemberActivity, setMemberActivityPolicy } from "@/lib/members/member-activity-store";
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

export interface MemberActivityActionResult { ok: boolean; message: string }

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
