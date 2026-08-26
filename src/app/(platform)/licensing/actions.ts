"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { submitLocalAccessRequest } from "@/lib/licensing/local-license-store";
import { licensePlans } from "@/lib/licensing/pricing";
import { getLicenseRenewalNotice } from "@/lib/licensing/renewal";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

const requestSchema = z.object({
  planId: z.enum(["monthly", "quarterly", "annual", "lifetime"]),
  reference: z.string().regex(/^CW-\d+-[A-Z0-9]{8}$/),
});

export interface SubmitAccessResult { reference: string; submittedAt: string }

export async function submitAccessRequest(input: unknown): Promise<SubmitAccessResult> {
  const parsed = requestSchema.parse(input);
  const [actor, telemetry, connection] = await Promise.all([getCurrentActor(), getWorkspaceTelemetry(), getConfiguredTornConnection()]);
  if (!actor.tornUserId || telemetry.source !== "live" || !telemetry.faction || !connection) throw new Error("A verified Torn connection is required.");
  if (connection.tornUserId !== actor.tornUserId || connection.factionId !== telemetry.faction.id) {
    throw new Error("This connection no longer matches your verified Torn player and faction. Reconnect before requesting access.");
  }
  if (!parsed.reference.startsWith(`CW-${telemetry.faction.id}-`)) throw new Error("The payment reference does not match the connected faction.");
  const plan = licensePlans.find((item) => item.id === parsed.planId);
  if (!plan) throw new Error("Unknown licence plan.");

  const submittedAt = new Date();
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await db.$transaction(async (tx) => {
      const user = await tx.user.upsert({ where: { tornUserId: actor.tornUserId }, update: { name: actor.name, isPlatformAdmin: actor.isPlatformAdmin, lastAuthenticatedAt: submittedAt }, create: { tornUserId: actor.tornUserId, name: actor.name, isPlatformAdmin: actor.isPlatformAdmin, lastAuthenticatedAt: submittedAt } });
      const faction = await tx.faction.upsert({ where: { tornFactionId: telemetry.faction!.id }, update: { name: telemetry.faction!.name, tag: telemetry.faction!.tag }, create: { tornFactionId: telemetry.faction!.id, name: telemetry.faction!.name, tag: telemetry.faction!.tag } });
      const activeLicense = await tx.factionLicense.findFirst({ where: { factionId: faction.id, status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: submittedAt } }] }, orderBy: { issuedAt: "desc" } });
      if (activeLicense && !getLicenseRenewalNotice(activeLicense.expiresAt, submittedAt).renewalOpen) {
        throw new Error(activeLicense.expiresAt
          ? "Renewal opens seven days before the current faction licence expires."
          : "This faction already has lifetime access and does not require renewal.");
      }
      const openRequest = await tx.accessRequest.findFirst({ where: { factionId: faction.id, status: { in: ["PENDING", "INFORMATION_REQUESTED"] } }, orderBy: { createdAt: "desc" } });
      if (openRequest) throw new Error(`Request ${openRequest.reference} is already awaiting owner review.`);
      const request = await tx.accessRequest.create({ data: { factionId: faction.id, submittedById: user.id, reference: parsed.reference, customerNote: JSON.stringify({ planId: plan.id, plan: plan.name, price: plan.price, term: plan.term, itemName: plan.itemName, itemQuantity: plan.itemQuantity, durationDays: plan.durationDays }) } });
      await tx.auditLog.create({ data: { factionId: faction.id, actorId: user.id, action: "ACCESS_REQUEST_SUBMITTED", entityType: "AccessRequest", entityId: request.id, metadata: { reference: request.reference, planId: plan.id, expectedItem: plan.itemName, expectedQuantity: plan.itemQuantity } } });
    });
  } else {
    submitLocalAccessRequest({ actor, faction: telemetry.faction, plan, reference: parsed.reference, submittedAt });
  }
  revalidatePath("/admin");
  revalidatePath("/unlock");
  revalidatePath("/", "layout");
  return { reference: parsed.reference, submittedAt: submittedAt.toISOString() };
}
