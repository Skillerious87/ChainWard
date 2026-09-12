import "server-only";

import type { FactionAccessRequest } from "@/lib/auth/faction-access-store";

export type AccessRequestViewStatus = "Pending" | "Information" | "Approved" | "Rejected" | "Cancelled";

/** The owner-console-wide "does anything need my review" summary, cheap
 *  enough to fetch on every route (unlike the full {@link getAccessRequestQueue}). */
export interface PendingReviewSummary {
  licenceCount: number;
  memberRequests: FactionAccessRequest[];
}

export interface TornIdentityView {
  name: string;
  tornUserId: number;
}

export interface AccessRequestView {
  requestId: string;
  faction: string;
  factionId: number;
  contact: TornIdentityView;
  reference: string;
  submittedAt: string;
  status: AccessRequestViewStatus;
  plan: string;
  planId: string;
  payment: string;
  term: string;
  reviewedBy: TornIdentityView | null;
  reviewedAt: string | null;
  privateNote: string | null;
}

export interface ActiveLicenseView {
  licenseId: string;
  faction: string;
  factionId: number;
  reference: string;
  term: string;
  issuedAt: string | null;
  expiresAt: string | null;
  approvedBy: TornIdentityView | null;
}

export interface AccessAuditView {
  id: string;
  action: string;
  reference: string | null;
  actor: TornIdentityView | null;
  createdAt: string;
}

export interface AccessQueueResult {
  databaseConfigured: boolean;
  requests: AccessRequestView[];
  factionCount: number;
  activeLicenseCount: number;
  activeLicenses: ActiveLicenseView[];
  auditEvents: AccessAuditView[];
  message: string;
}

export async function getAccessRequestQueue(): Promise<AccessQueueResult> {
  if (!process.env.DATABASE_URL?.trim()) {
    try {
      const { getLocalAccessRequestQueue } = await import("./local-license-store");
      return getLocalAccessRequestQueue();
    } catch {
      return { databaseConfigured: false, requests: [], factionCount: 0, activeLicenseCount: 0, activeLicenses: [], auditEvents: [], message: "The temporary local database could not be queried." };
    }
  }
  try {
    const { db } = await import("@/lib/db");
    const [rows, factionCount, licenses, auditRows] = await Promise.all([
      db.accessRequest.findMany({ include: { faction: true, submittedBy: true, reviewedBy: true }, orderBy: { createdAt: "desc" } }),
      db.faction.count(),
      db.factionLicense.findMany({ where: { status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, include: { faction: true, approvedBy: true }, orderBy: { issuedAt: "desc" } }),
      // Filtering (actor/action/date) happens client-side over this window in
      // AccessAuditTimeline, so it needs more than a handful of recent rows.
      db.auditLog.findMany({ where: { action: { startsWith: "ACCESS_REQUEST_" } }, include: { actor: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    ]);
    return {
      databaseConfigured: true,
      factionCount,
      activeLicenseCount: licenses.length,
      activeLicenses: licenses.map((license) => ({ licenseId: license.id, faction: license.faction.name, factionId: license.faction.tornFactionId, reference: license.reference, term: termLabel(license.term), issuedAt: license.issuedAt?.toISOString() ?? null, expiresAt: license.expiresAt?.toISOString() ?? null, approvedBy: license.approvedBy ? { name: license.approvedBy.name, tornUserId: license.approvedBy.tornUserId } : null })),
      auditEvents: auditRows.map((event) => ({ id: event.id, action: auditLabel(event.action), reference: auditReference(event.metadata), actor: event.actor ? { name: event.actor.name, tornUserId: event.actor.tornUserId } : null, createdAt: event.createdAt.toISOString() })),
      message: `${rows.length} stored access request${rows.length === 1 ? "" : "s"}.`,
      requests: rows.map((row) => {
        const meta = parseRequestMetadata(row.customerNote);
        return {
          requestId: row.id,
          faction: row.faction.name,
          factionId: row.faction.tornFactionId,
          contact: { name: row.submittedBy.name, tornUserId: row.submittedBy.tornUserId },
          reference: row.reference,
          submittedAt: row.createdAt.toISOString(),
          status: mapStatus(row.status),
          plan: meta.plan,
          planId: meta.planId,
          payment: meta.price,
          term: meta.term,
          reviewedBy: row.reviewedBy ? { name: row.reviewedBy.name, tornUserId: row.reviewedBy.tornUserId } : null,
          reviewedAt: row.reviewedAt?.toISOString() ?? null,
          privateNote: row.privateNote,
        };
      }),
    };
  } catch {
    return { databaseConfigured: true, requests: [], factionCount: 0, activeLicenseCount: 0, activeLicenses: [], auditEvents: [], message: "The configured database could not be queried." };
  }
}

/** A cheap, indexed pending-count — safe to call on every navigation, unlike
 *  {@link getAccessRequestQueue}'s full site-wide history fetch. */
export async function getLicenceReviewCount(): Promise<number> {
  if (!process.env.DATABASE_URL?.trim()) {
    try {
      const { getLocalLicenceReviewCount } = await import("./local-license-store");
      return getLocalLicenceReviewCount();
    } catch {
      return 0;
    }
  }
  try {
    const { db } = await import("@/lib/db");
    return await db.accessRequest.count({ where: { status: { in: ["PENDING", "INFORMATION_REQUESTED"] } } });
  } catch {
    return 0;
  }
}

function termLabel(term: string): string {
  if (term === "PERMANENT") return "Lifetime";
  if (term === "YEARLY") return "Annual";
  if (term === "QUARTERLY") return "Quarterly";
  if (term === "MONTHLY") return "Monthly";
  return term.toLowerCase().replaceAll("_", " ");
}

function auditLabel(action: string): string {
  return action.replace("ACCESS_REQUEST_", "").toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function auditReference(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("reference" in value)) return null;
  return typeof value.reference === "string" ? value.reference : null;
}

export function parseRequestMetadata(value: string | null): { planId: string; plan: string; price: string; term: string } {
  try {
    const parsed = JSON.parse(value ?? "{}") as Record<string, unknown>;
    return {
      planId: typeof parsed.planId === "string" ? parsed.planId : "unknown",
      plan: typeof parsed.plan === "string" ? parsed.plan : "Not recorded",
      price: typeof parsed.price === "string" ? parsed.price : "Not recorded",
      term: typeof parsed.term === "string" ? parsed.term : "Not recorded",
    };
  } catch {
    return { planId: "unknown", plan: "Not recorded", price: "Not recorded", term: "Not recorded" };
  }
}

function mapStatus(status: string): AccessRequestViewStatus {
  if (status === "INFORMATION_REQUESTED") return "Information";
  if (status === "APPROVED") return "Approved";
  if (status === "REJECTED") return "Rejected";
  if (status === "CANCELLED") return "Cancelled";
  return "Pending";
}
