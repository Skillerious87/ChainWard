"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { requirePlatformOwner } from "@/lib/auth/platform-owner";
import { licensePlans } from "@/lib/licensing/pricing";
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

export async function reviewAccessRequest(input: unknown): Promise<ReviewAccessResult> {
  const actor = await getCurrentActor();
  requirePlatformOwner(actor);
  if (!process.env.DATABASE_URL?.trim()) throw new Error("PostgreSQL is required for the central licence register.");
  const parsed = reviewSchema.parse(input);
  const { db } = await import("@/lib/db");
  const reviewedAt = new Date();

  const result = await db.$transaction(async (tx) => {
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
      const conflicting = await tx.factionLicense.findFirst({ where: { factionId: existing.factionId, status: "ACTIVE", reference: { not: existing.reference }, OR: [{ expiresAt: null }, { expiresAt: { gt: reviewedAt } }] } });
      if (conflicting) throw new Error(`Faction access is already active under ${conflicting.reference}. Resolve that licence before approving another.`);
      const expiresAt = plan.durationDays === null ? null : new Date(reviewedAt.getTime() + plan.durationDays * 86_400_000);
      await tx.factionLicense.upsert({
        where: { reference: existing.reference },
        update: { status: "ACTIVE", term: plan.licenseTerm, issuedAt: reviewedAt, expiresAt, approvedById: reviewer.id, paymentNotes: `Manually matched ${plan.itemQuantity} ${plan.itemName} to ${existing.reference}.`, internalNotes: parsed.note || null },
        create: { factionId: existing.factionId, status: "ACTIVE", term: plan.licenseTerm, reference: existing.reference, issuedAt: reviewedAt, expiresAt, approvedById: reviewer.id, paymentNotes: `Manually matched ${plan.itemQuantity} ${plan.itemName} to ${existing.reference}.`, internalNotes: parsed.note || null },
      });
    }

    await tx.auditLog.create({ data: { factionId: existing.factionId, actorId: reviewer.id, action: `ACCESS_REQUEST_${status}`, entityType: "AccessRequest", entityId: existing.id, metadata: { reference: existing.reference, decision: parsed.decision, submittedByTornId: existing.submittedBy.tornUserId, paymentMatched: parsed.decision === "Approved" } } });
    return { reviewedBy: { name: actor.name, tornUserId: actor.tornUserId } };
  });

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { requestId: parsed.requestId, status: parsed.decision, reviewedBy: result.reviewedBy, reviewedAt: reviewedAt.toISOString() };
}

function withReviewMessage(value: string | null, reviewMessage: string): string {
  try { const parsed = JSON.parse(value ?? "{}") as Record<string, unknown>; return JSON.stringify({ ...parsed, reviewMessage }); }
  catch { return JSON.stringify({ reviewMessage }); }
}
