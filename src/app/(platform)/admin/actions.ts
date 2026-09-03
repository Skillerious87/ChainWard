"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { removeFactionMemberAccess, updateFactionMemberAccess, type FactionAccessActionResult } from "@/app/(platform)/faction/actions";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { requirePlatformOwner } from "@/lib/auth/platform-owner";
import { licensePlans } from "@/lib/licensing/pricing";
import { getLicenseRenewalNotice, renewalExpiry } from "@/lib/licensing/renewal";
import { reviewLocalAccessRequest } from "@/lib/licensing/local-license-store";
import { parseRequestMetadata, type AccessRequestViewStatus, type TornIdentityView } from "@/lib/licensing/request-store";

const reviewSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["Approved", "Information", "Rejected"]),
  note: z.string().trim().max(500).default(""),
  paymentMatched: z.boolean().default(false),
  referenceConfirmation: z.string().trim().max(80).default(""),
}).superRefine((value, context) => {
  if (value.decision === "Approved" && !value.paymentMatched) context.addIssue({ code: "custom", path: ["paymentMatched"], message: "Confirm that the Torn item transfer was matched before approval." });
  if (value.decision !== "Approved" && value.note.length < 3) context.addIssue({ code: "custom", path: ["note"], message: "Add a short review note." });
});

export interface ReviewAccessResult { requestId: string; status: AccessRequestViewStatus; reviewedBy: TornIdentityView; reviewedAt: string }

/** Owner-console entry points deliberately repeat the owner check before the
 * faction action performs its own guard and object-level validation. */
export async function updateAdminMemberAccess(input: unknown): Promise<FactionAccessActionResult> {
  requirePlatformOwner(await getCurrentActor());
  const result = await updateFactionMemberAccess(input);
  revalidatePath("/admin");
  return result;
}

export async function revokeAdminMemberAccess(input: unknown): Promise<FactionAccessActionResult> {
  requirePlatformOwner(await getCurrentActor());
  const result = await removeFactionMemberAccess(input);
  revalidatePath("/admin");
  return result;
}

export async function reviewAccessRequest(input: unknown): Promise<ReviewAccessResult> {
  const actor = await getCurrentActor();
  requirePlatformOwner(actor);
  const parsed = reviewSchema.parse(input);
  const reviewedAt = new Date();

  const result = process.env.DATABASE_URL?.trim()
    ? await reviewPostgresAccessRequest(actor, parsed, reviewedAt)
    : reviewLocalAccessRequest({ actor, ...parsed, reviewedAt, plans: licensePlans });

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { requestId: parsed.requestId, status: parsed.decision, reviewedBy: result.reviewedBy, reviewedAt: reviewedAt.toISOString() };
}

async function reviewPostgresAccessRequest(
  actor: Awaited<ReturnType<typeof getCurrentActor>>,
  parsed: z.infer<typeof reviewSchema>,
  reviewedAt: Date,
): Promise<{ reviewedBy: TornIdentityView }> {
  const { db } = await import("@/lib/db");
  return db.$transaction(async (tx) => {
    const existing = await tx.accessRequest.findUnique({ where: { id: parsed.requestId }, include: { faction: true, submittedBy: true } });
    if (!existing) throw new Error("Access request not found.");
    if (!(["PENDING", "INFORMATION_REQUESTED"] as string[]).includes(existing.status)) throw new Error(`This request is already ${existing.status.toLowerCase().replaceAll("_", " ")}.`);
    if (parsed.decision === "Approved" && parsed.referenceConfirmation !== existing.reference) throw new Error("The confirmed payment reference does not exactly match this request.");

    const reviewer = await tx.user.upsert({ where: { tornUserId: actor.tornUserId }, update: { name: actor.name, isPlatformAdmin: true, lastAuthenticatedAt: reviewedAt }, create: { tornUserId: actor.tornUserId, name: actor.name, isPlatformAdmin: true, lastAuthenticatedAt: reviewedAt } });
    const status = parsed.decision === "Information" ? "INFORMATION_REQUESTED" : parsed.decision === "Approved" ? "APPROVED" : "REJECTED";
    await tx.accessRequest.update({ where: { id: existing.id }, data: { status, privateNote: parsed.note || null, customerNote: parsed.decision === "Information" ? withReviewMessage(existing.customerNote, parsed.note) : existing.customerNote, reviewedById: reviewer.id, reviewedAt } });

    if (parsed.decision === "Approved") {
      const meta = parseRequestMetadata(existing.customerNote);
      const plan = licensePlans.find((item) => item.id === meta.planId);
      if (!plan) throw new Error("The stored request does not contain a recognized licence plan.");
      const currentLicense = await tx.factionLicense.findFirst({ where: { factionId: existing.factionId, status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: reviewedAt } }] }, orderBy: { issuedAt: "desc" } });
      const renewal = Boolean(currentLicense);
      if (currentLicense && !getLicenseRenewalNotice(currentLicense.expiresAt, reviewedAt).renewalOpen) {
        throw new Error(currentLicense.expiresAt
          ? "This renewal was reviewed before the seven-day renewal window opened."
          : "This faction already has lifetime access and cannot be renewed.");
      }
      const expiresAt = renewalExpiry(currentLicense?.expiresAt ?? null, plan.durationDays, reviewedAt);
      const paymentNote = `${renewal ? "Renewal" : "Initial access"}: manually matched ${plan.itemQuantity} ${plan.itemName} to ${existing.reference}.`;
      const licence = currentLicense
        ? await tx.factionLicense.update({ where: { id: currentLicense.id }, data: { status: "ACTIVE", term: plan.licenseTerm, reference: existing.reference, expiresAt, approvedById: reviewer.id, paymentNotes: [currentLicense.paymentNotes, paymentNote].filter(Boolean).join("\n"), internalNotes: parsed.note || currentLicense.internalNotes } })
        : await tx.factionLicense.create({ data: { factionId: existing.factionId, status: "ACTIVE", term: plan.licenseTerm, reference: existing.reference, issuedAt: reviewedAt, expiresAt, approvedById: reviewer.id, paymentNotes: paymentNote, internalNotes: parsed.note || null } });

      const previousMembership = await tx.factionMembership.findUnique({ where: { factionId_userId: { factionId: existing.factionId, userId: existing.submittedById } } });
      const previousRoleIsActive = previousMembership && previousMembership.status !== "INVITED" && previousMembership.status !== "REMOVED";
      const purchaserRole = previousRoleIsActive && previousMembership.role !== "OWNER" ? previousMembership.role : renewal ? "VIEWER" : "ADMINISTRATOR";
      const membership = await tx.factionMembership.upsert({
        where: { factionId_userId: { factionId: existing.factionId, userId: existing.submittedById } },
        update: { role: purchaserRole, status: "ACTIVE" },
        create: { factionId: existing.factionId, userId: existing.submittedById, role: purchaserRole, status: "ACTIVE" },
      });
      await tx.auditLog.create({ data: { factionId: existing.factionId, actorId: reviewer.id, action: "faction_access.purchaser_granted", entityType: "FactionMembership", entityId: membership.id, metadata: { tornUserId: existing.submittedBy.tornUserId, memberName: existing.submittedBy.name, action: previousRoleIsActive ? "UPDATED" : "GRANTED", role: purchaserRole, status: "ACTIVE", source: "verified_payment", reference: existing.reference } } });
      await tx.auditLog.create({ data: { factionId: existing.factionId, actorId: reviewer.id, action: renewal ? "FACTION_LICENSE_RENEWED" : "FACTION_LICENSE_ACTIVATED", entityType: "FactionLicense", entityId: licence.id, metadata: { reference: existing.reference, previousReference: currentLicense?.reference ?? null, renewal, expiresAt: expiresAt?.toISOString() ?? null } } });
    }

    await tx.auditLog.create({ data: { factionId: existing.factionId, actorId: reviewer.id, action: `ACCESS_REQUEST_${status}`, entityType: "AccessRequest", entityId: existing.id, metadata: { reference: existing.reference, decision: parsed.decision, submittedByTornId: existing.submittedBy.tornUserId, paymentMatched: parsed.decision === "Approved" } } });
    return { reviewedBy: { name: actor.name, tornUserId: actor.tornUserId } };
  });
}

function withReviewMessage(value: string | null, reviewMessage: string): string {
  try { const parsed = JSON.parse(value ?? "{}") as Record<string, unknown>; return JSON.stringify({ ...parsed, reviewMessage }); }
  catch { return JSON.stringify({ reviewMessage }); }
}
