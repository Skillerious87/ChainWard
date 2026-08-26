import "server-only";

import { cache } from "react";
import type { FactionAccessSummary } from "./types";

export const getFactionAccessSummary = cache(async (tornFactionId: number | null): Promise<FactionAccessSummary> => {
  if (!tornFactionId) return inactive();
  if (!process.env.DATABASE_URL?.trim()) {
    try {
      const { getLocalFactionAccessSummary } = await import("./local-license-store");
      return getLocalFactionAccessSummary(tornFactionId);
    } catch {
      return inactive();
    }
  }
  try {
    const { db } = await import("@/lib/db");
    const now = new Date();
    const faction = await db.faction.findUnique({ where: { tornFactionId }, select: { id: true } });
    if (!faction) return inactive();
    const license = await db.factionLicense.findFirst({
      where: { factionId: faction.id, status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { issuedAt: "desc" },
    });
    if (license) {
      const pendingRenewal = await db.accessRequest.findFirst({ where: { factionId: faction.id, status: { in: ["PENDING", "INFORMATION_REQUESTED"] } }, orderBy: { createdAt: "desc" } });
      const renewalMeta = pendingRenewal ? parseMetadata(pendingRenewal.customerNote) : null;
      return {
      state: "active",
      label: license.term === "PERMANENT" ? "Lifetime access" : license.term === "YEARLY" ? "Annual access" : license.term === "QUARTERLY" ? "Quarterly access" : license.term === "MONTHLY" ? "Monthly access" : "Faction access",
      expiresAt: license.expiresAt?.toISOString() ?? null,
      reference: license.reference,
      startedAt: license.issuedAt?.toISOString() ?? null,
      plan: license.term,
      payment: null,
      message: null,
      renewalRequest: pendingRenewal ? { reference: pendingRenewal.reference, startedAt: pendingRenewal.createdAt.toISOString(), plan: renewalMeta?.plan ?? null, payment: renewalMeta?.price ?? null, message: renewalMeta?.reviewMessage ?? null } : null,
    };
    }
    const pending = await db.accessRequest.findFirst({ where: { factionId: faction.id, status: { in: ["PENDING", "INFORMATION_REQUESTED"] } }, orderBy: { createdAt: "desc" } });
    if (pending) {
      const meta = parseMetadata(pending.customerNote);
      return { state: "pending", label: pending.status === "INFORMATION_REQUESTED" ? "More information required" : "Owner review required", expiresAt: null, reference: pending.reference, startedAt: pending.createdAt.toISOString(), plan: meta.plan, payment: meta.price, message: meta.reviewMessage };
    }
    return inactive();
  } catch {
    return inactive();
  }
});

function inactive(): FactionAccessSummary {
  return { state: "inactive", label: "Faction-wide licence", expiresAt: null, reference: null, startedAt: null, plan: null, payment: null, message: null };
}

function parseMetadata(value: string | null): { plan: string | null; price: string | null; reviewMessage: string | null } {
  try { const parsed = JSON.parse(value ?? "{}") as Record<string, unknown>; return { plan: typeof parsed.plan === "string" ? parsed.plan : null, price: typeof parsed.price === "string" ? parsed.price : null, reviewMessage: typeof parsed.reviewMessage === "string" ? parsed.reviewMessage : null }; }
  catch { return { plan: null, price: null, reviewMessage: null }; }
}
