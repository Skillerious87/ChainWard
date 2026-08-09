"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { licensePlans } from "@/lib/licensing/pricing";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

const requestSchema = z.object({
  planId: z.enum(["monthly", "quarterly", "annual", "lifetime"]),
  reference: z.string().regex(/^CW-\d+-[A-Z0-9]{8}$/),
});

export interface SubmitAccessResult { reference: string; submittedAt: string }

export async function submitAccessRequest(input: unknown): Promise<SubmitAccessResult> {
  if (!process.env.DATABASE_URL) throw new Error("The Chainward database is not configured, so the request was not submitted.");
  const parsed = requestSchema.parse(input);
  const [actor, telemetry] = await Promise.all([getCurrentActor(), getWorkspaceTelemetry()]);
  if (!actor.tornUserId || telemetry.source !== "live" || !telemetry.faction) throw new Error("A verified Torn connection is required.");
  if (!parsed.reference.startsWith(`CW-${telemetry.faction.id}-`)) throw new Error("The payment reference does not match the connected faction.");
  const plan = licensePlans.find((item) => item.id === parsed.planId);
  if (!plan) throw new Error("Unknown licence plan.");

  const { db } = await import("@/lib/db");
  const submittedAt = new Date();
  await db.$transaction(async (tx) => {
    const user = await tx.user.upsert({ where: { tornUserId: actor.tornUserId }, update: { name: actor.name, isPlatformAdmin: actor.isPlatformAdmin, lastAuthenticatedAt: submittedAt }, create: { tornUserId: actor.tornUserId, name: actor.name, isPlatformAdmin: actor.isPlatformAdmin, lastAuthenticatedAt: submittedAt } });
    const faction = await tx.faction.upsert({ where: { tornFactionId: telemetry.faction!.id }, update: { name: telemetry.faction!.name, tag: telemetry.faction!.tag }, create: { tornFactionId: telemetry.faction!.id, name: telemetry.faction!.name, tag: telemetry.faction!.tag } });
    const activeLicense = await tx.factionLicense.findFirst({ where: { factionId: faction.id, status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: submittedAt } }] } });
    if (activeLicense) throw new Error(`This faction already has active access under ${activeLicense.reference}.`);
    const openRequest = await tx.accessRequest.findFirst({ where: { factionId: faction.id, status: { in: ["PENDING", "INFORMATION_REQUESTED"] } }, orderBy: { createdAt: "desc" } });
    if (openRequest) throw new Error(`Request ${openRequest.reference} is already awaiting owner review.`);
    const request = await tx.accessRequest.create({ data: { factionId: faction.id, submittedById: user.id, reference: parsed.reference, customerNote: JSON.stringify({ planId: plan.id, plan: plan.name, price: plan.price, term: plan.term, itemName: plan.itemName, itemQuantity: plan.itemQuantity, durationDays: plan.durationDays }) } });
    await tx.auditLog.create({ data: { factionId: faction.id, actorId: user.id, action: "ACCESS_REQUEST_SUBMITTED", entityType: "AccessRequest", entityId: request.id, metadata: { reference: request.reference, planId: plan.id, expectedItem: plan.itemName, expectedQuantity: plan.itemQuantity } } });
  });
  revalidatePath("/admin");
  revalidatePath("/unlock");
  revalidatePath("/", "layout");
  return { reference: parsed.reference, submittedAt: submittedAt.toISOString() };
}
