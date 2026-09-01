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
    // Both records can be selected directly through the faction relation.
    // This removes the preliminary faction lookup and runs the remaining
    // database reads together on the request-critical authorization path.
    const [license, pendingRenewal] = await Promise.all([
      db.factionLicense.findFirst({
        where: { faction: { tornFactionId }, status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        orderBy: { issuedAt: "desc" },
      }),
      db.accessRequest.findFirst({
        where: { faction: { tornFactionId }, status: { in: ["PENDING", "INFORMATION_REQUESTED"] } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (license) {
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
    if (pendingRenewal) {
      const meta = parseMetadata(pendingRenewal.customerNote);
      return { state: "pending", label: pendingRenewal.status === "INFORMATION_REQUESTED" ? "More information required" : "Owner review required", expiresAt: null, reference: pendingRenewal.reference, startedAt: pendingRenewal.createdAt.toISOString(), plan: meta.plan, payment: meta.price, message: meta.reviewMessage };
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
