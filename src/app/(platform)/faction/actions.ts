"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { roleLabel } from "@/lib/auth/authorization";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessWorkspace, revokeFactionAccess, setFactionAccess, setFactionAccessBatch } from "@/lib/auth/faction-access-store";
import { isPlatformOwner, PLATFORM_OWNER } from "@/lib/auth/platform-owner";
import { requireActiveFactionLicense } from "@/lib/licensing/guards";
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
    const changed = await setFactionAccess(verified.faction, verified.member, verified.actorTornUserId, parsed.data.role, parsed.data.status);
    revalidatePath("/faction");
    return { ok: true, message: changed ? `${verified.member.memberName} now has ${roleLabel(parsed.data.role)} access${parsed.data.status === "SUSPENDED" ? " in a suspended state" : ""}.` : `${verified.member.memberName} already has that role and status. No audit event was added.` };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

export async function removeFactionMemberAccess(input: unknown): Promise<FactionAccessActionResult> {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The access removal request was invalid." };
  try {
    const verified = await verifiedRevokeTarget(parsed.data.factionId, parsed.data.tornUserId);
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
    const changed = await setFactionAccessBatch(verified.faction, verified.members, verified.actorTornUserId, parsed.data.role, parsed.data.status);
    revalidatePath("/faction");
    return { ok: true, message: changed ? `${changed} member${changed === 1 ? "" : "s"} updated to ${roleLabel(parsed.data.role)}${parsed.data.status === "SUSPENDED" ? " and suspended" : ""}.` : "Every selected member already had that role and status. No audit events were added." };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

async function verifiedTarget(factionId: number, tornUserId: number) {
  rejectOwnerTarget(tornUserId);
  const [actor, telemetry, roster] = await Promise.all([getCurrentActor(), getWorkspaceTelemetry(), getFactionRoster()]);
  if (!isPlatformOwner(actor)) throw new Error("Only the platform owner can change application access in this release.");
  if (telemetry.source !== "live" || !telemetry.faction || telemetry.faction.id !== factionId) throw new Error("The connected faction could not be verified for this request.");
  await requireActiveFactionLicense(telemetry.faction.id);
  if (!roster.available) throw new Error("The verified faction roster could not be read, so access was not changed.");
  const rosterMember = roster.data.find((member) => member.tornId === tornUserId);
  if (!rosterMember) throw new Error("The selected player is not in the current verified faction roster.");
  return {
    actorTornUserId: actor.tornUserId,
    faction: { id: telemetry.faction.id, name: telemetry.faction.name, tag: telemetry.faction.tag },
    member: { tornUserId: rosterMember.tornId, memberName: rosterMember.name },
  };
}

/**
 * Revocation deliberately does not require current roster membership. Removing
 * a stale assignment is most necessary precisely when the member has left the
 * faction, and requiring them to still be on the roster made those rows
 * permanent.
 */
async function verifiedRevokeTarget(factionId: number, tornUserId: number) {
  rejectOwnerTarget(tornUserId);
  const [actor, telemetry, roster] = await Promise.all([getCurrentActor(), getWorkspaceTelemetry(), getFactionRoster()]);
  if (!isPlatformOwner(actor)) throw new Error("Only the platform owner can change application access in this release.");
  if (telemetry.source !== "live" || !telemetry.faction || telemetry.faction.id !== factionId) throw new Error("The connected faction could not be verified for this request.");
  await requireActiveFactionLicense(telemetry.faction.id);
  const access = await getFactionAccessWorkspace(telemetry.faction.id);
  const assignment = access.assignments.find((item) => item.tornUserId === tornUserId);
  if (!assignment) throw new Error("This player does not have an application access assignment to revoke.");
  const rosterMember = roster.available ? roster.data.find((member) => member.tornId === tornUserId) : null;
  return {
    actorTornUserId: actor.tornUserId,
    faction: { id: telemetry.faction.id, name: telemetry.faction.name, tag: telemetry.faction.tag },
    member: { tornUserId, memberName: rosterMember?.name ?? assignment.memberName },
  };
}

async function verifiedTargets(factionId: number, tornUserIds: number[]) {
  for (const tornUserId of tornUserIds) rejectOwnerTarget(tornUserId);
  const [actor, telemetry, roster] = await Promise.all([getCurrentActor(), getWorkspaceTelemetry(), getFactionRoster()]);
  if (!isPlatformOwner(actor)) throw new Error("Only the platform owner can change application access in this release.");
  if (telemetry.source !== "live" || !telemetry.faction || telemetry.faction.id !== factionId) throw new Error("The connected faction could not be verified for this request.");
  await requireActiveFactionLicense(telemetry.faction.id);
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

/**
 * The role policy screen states that owner access cannot be assigned,
 * suspended, or revoked. Enforce that here rather than relying on the interface
 * to hide the control: a stored `Skillerious — Viewer — Suspended` row would
 * contradict the access the owner actually keeps through `isPlatformOwner`.
 */
function rejectOwnerTarget(tornUserId: number): void {
  if (tornUserId === PLATFORM_OWNER.tornUserId) {
    throw new Error("Platform owner access is intrinsic and cannot be assigned, suspended, or revoked.");
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The access registry could not be updated safely.";
}
