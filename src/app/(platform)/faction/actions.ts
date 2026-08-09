"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { revokeFactionAccess, setFactionAccess, setFactionAccessBatch } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

const assignmentSchema = z.object({
  factionId: z.number().int().positive(),
  tornUserId: z.number().int().positive(),
  role: z.enum(["ADMINISTRATOR", "CHAIN_MANAGER", "VIEWER"]),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

const revokeSchema = assignmentSchema.pick({ factionId: true, tornUserId: true });
const batchAssignmentSchema = assignmentSchema.omit({ tornUserId: true }).extend({
  tornUserIds: z.array(z.number().int().positive()).min(1).max(50),
}).superRefine((value, context) => {
  if (new Set(value.tornUserIds).size !== value.tornUserIds.length) context.addIssue({ code: "custom", message: "Duplicate members are not allowed.", path: ["tornUserIds"] });
});

export interface FactionAccessActionResult {
  ok: boolean;
  message: string;
}

export async function updateFactionMemberAccess(input: unknown): Promise<FactionAccessActionResult> {
  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The access assignment was incomplete or invalid." };
  try {
    const verified = await verifiedTarget(parsed.data.factionId, parsed.data.tornUserId);
    await setFactionAccess(verified.faction, verified.member, verified.actorTornUserId, parsed.data.role, parsed.data.status);
    revalidatePath("/faction");
    return { ok: true, message: `${verified.member.memberName} now has ${roleLabel(parsed.data.role)} access${parsed.data.status === "SUSPENDED" ? " in a suspended state" : ""}.` };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function removeFactionMemberAccess(input: unknown): Promise<FactionAccessActionResult> {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The access removal request was invalid." };
  try {
    const verified = await verifiedTarget(parsed.data.factionId, parsed.data.tornUserId);
    await revokeFactionAccess(verified.faction, verified.member, verified.actorTornUserId);
    revalidatePath("/faction");
    return { ok: true, message: `${verified.member.memberName}'s application access was revoked.` };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function updateFactionMemberAccessBatch(input: unknown): Promise<FactionAccessActionResult> {
  const parsed = batchAssignmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Select between 1 and 50 valid faction members." };
  try {
    const verified = await verifiedTargets(parsed.data.factionId, parsed.data.tornUserIds);
    await setFactionAccessBatch(verified.faction, verified.members, verified.actorTornUserId, parsed.data.role, parsed.data.status);
    revalidatePath("/faction");
    return { ok: true, message: `${verified.members.length} member${verified.members.length === 1 ? "" : "s"} updated to ${roleLabel(parsed.data.role)}${parsed.data.status === "SUSPENDED" ? " and suspended" : ""}.` };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

async function verifiedTarget(factionId: number, tornUserId: number) {
  const [actor, telemetry, roster] = await Promise.all([getCurrentActor(), getWorkspaceTelemetry(), getFactionRoster()]);
  if (!isPlatformOwner(actor)) throw new Error("Only the platform owner can change application access in this release.");
  if (telemetry.source !== "live" || !telemetry.faction || telemetry.faction.id !== factionId) throw new Error("The connected faction could not be verified for this request.");
  const rosterMember = roster.available ? roster.data.find((member) => member.tornId === tornUserId) : null;
  if (!rosterMember) throw new Error("The selected player is not in the current verified faction roster.");
  return {
    actorTornUserId: actor.tornUserId,
    faction: { id: telemetry.faction.id, name: telemetry.faction.name, tag: telemetry.faction.tag },
    member: { tornUserId: rosterMember.tornId, memberName: rosterMember.name },
  };
}

async function verifiedTargets(factionId: number, tornUserIds: number[]) {
  const [actor, telemetry, roster] = await Promise.all([getCurrentActor(), getWorkspaceTelemetry(), getFactionRoster()]);
  if (!isPlatformOwner(actor)) throw new Error("Only the platform owner can change application access in this release.");
  if (telemetry.source !== "live" || !telemetry.faction || telemetry.faction.id !== factionId) throw new Error("The connected faction could not be verified for this request.");
  if (!roster.available) throw new Error("The current faction roster could not be verified.");
  const rosterById = new Map(roster.data.map((member) => [member.tornId, member]));
  const members = tornUserIds.map((tornUserId) => rosterById.get(tornUserId));
  if (members.some((member) => !member)) throw new Error("At least one selected player is not in the current verified faction roster.");
  return {
    actorTornUserId: actor.tornUserId,
    faction: { id: telemetry.faction.id, name: telemetry.faction.name, tag: telemetry.faction.tag },
    members: members.map((member) => ({ tornUserId: member!.tornId, memberName: member!.name })),
  };
}

function roleLabel(role: "ADMINISTRATOR" | "CHAIN_MANAGER" | "VIEWER"): string {
  return role === "ADMINISTRATOR" ? "Administrator" : role === "CHAIN_MANAGER" ? "Chain manager" : "Viewer";
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The access registry could not be updated safely.";
}
