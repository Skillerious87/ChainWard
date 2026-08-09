import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { requirePlatformOwner, type PlatformActor } from "@/lib/auth/platform-owner";
import { openLocalTestDatabase } from "@/lib/data/local-database";
import type { FactionAccessSummary } from "./types";
import type {
  AccessAuditView,
  AccessQueueResult,
  AccessRequestView,
  AccessRequestViewStatus,
  ActiveLicenseView,
  TornIdentityView,
} from "./request-store";

interface LocalPlan {
  id: string;
  name: string;
  price: string;
  itemName: string;
  itemQuantity: number;
  term: string;
  durationDays: number | null;
  licenseTerm: string;
}

interface LocalFaction {
  id: number;
  name: string;
  tag: string;
}

interface RequestRow {
  id: string;
  faction_id: number;
  faction_name: string;
  submitted_by_torn_id: number;
  submitted_by_name: string;
  reviewed_by_torn_id: number | null;
  reviewed_by_name: string | null;
  status: string;
  reference: string;
  customer_note: string | null;
  private_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface LicenseRow {
  id: string;
  faction_id: number;
  faction_name: string;
  reference: string;
  term: string;
  issued_at: string | null;
  expires_at: string | null;
  approved_by_torn_id: number | null;
  approved_by_name: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  metadata_json: string | null;
  actor_torn_user_id: number | null;
  actor_name: string | null;
  created_at: string;
}

export function submitLocalAccessRequest(input: {
  actor: PlatformActor;
  faction: LocalFaction;
  plan: LocalPlan;
  reference: string;
  submittedAt: Date;
}): void {
  const database = requiredDatabase();
  const submittedAt = input.submittedAt.toISOString();
  try {
    transaction(database, () => {
      upsertUser(database, input.actor, submittedAt);
    database.prepare(`
      INSERT INTO licensing_factions (faction_id, name, tag, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(faction_id) DO UPDATE SET name = excluded.name, tag = excluded.tag, updated_at = excluded.updated_at
    `).run(input.faction.id, input.faction.name, input.faction.tag, submittedAt);

    const active = database.prepare(`
      SELECT reference FROM licensing_faction_licenses
      WHERE faction_id = ? AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > ?)
      LIMIT 1
    `).get(input.faction.id, submittedAt) as unknown as { reference: string } | undefined;
    if (active) throw new Error(`This faction already has active access under ${active.reference}.`);

    const pending = database.prepare(`
      SELECT reference FROM licensing_access_requests
      WHERE faction_id = ? AND status IN ('PENDING', 'INFORMATION_REQUESTED')
      ORDER BY created_at DESC LIMIT 1
    `).get(input.faction.id) as unknown as { reference: string } | undefined;
    if (pending) throw new Error(`Request ${pending.reference} is already awaiting owner review.`);

    const requestId = randomUUID();
    const customerNote = JSON.stringify({
      planId: input.plan.id,
      plan: input.plan.name,
      price: input.plan.price,
      term: input.plan.term,
      itemName: input.plan.itemName,
      itemQuantity: input.plan.itemQuantity,
      durationDays: input.plan.durationDays,
    });
    database.prepare(`
      INSERT INTO licensing_access_requests (
        id, faction_id, submitted_by_torn_id, status, reference, customer_note, created_at, updated_at
      ) VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?)
    `).run(requestId, input.faction.id, input.actor.tornUserId, input.reference, customerNote, submittedAt, submittedAt);
    insertAudit(database, {
      factionId: input.faction.id,
      actorTornUserId: input.actor.tornUserId,
      action: "ACCESS_REQUEST_SUBMITTED",
      entityId: requestId,
      metadata: { reference: input.reference, planId: input.plan.id, expectedItem: input.plan.itemName, expectedQuantity: input.plan.itemQuantity },
      createdAt: submittedAt,
    });
    });
  } finally {
    database.close();
  }
}

export function reviewLocalAccessRequest(input: {
  actor: PlatformActor;
  requestId: string;
  decision: "Approved" | "Information" | "Rejected";
  note: string;
  referenceConfirmation: string;
  reviewedAt: Date;
  plans: readonly LocalPlan[];
}): { reviewedBy: TornIdentityView } {
  requirePlatformOwner(input.actor);
  const database = requiredDatabase();
  const reviewedAt = input.reviewedAt.toISOString();
  try {
    return transaction(database, () => {
      const existing = database.prepare(`
        SELECT r.*, f.name AS faction_name, u.name AS submitted_by_name,
          NULL AS reviewed_by_name
        FROM licensing_access_requests r
        JOIN licensing_factions f ON f.faction_id = r.faction_id
        JOIN licensing_users u ON u.torn_user_id = r.submitted_by_torn_id
        WHERE r.id = ?
      `).get(input.requestId) as unknown as RequestRow | undefined;
      if (!existing) throw new Error("Access request not found.");
      if (!(["PENDING", "INFORMATION_REQUESTED"] as string[]).includes(existing.status)) {
        throw new Error(`This request is already ${existing.status.toLowerCase().replaceAll("_", " ")}.`);
      }
      if (input.decision === "Approved" && input.referenceConfirmation !== existing.reference) {
        throw new Error("The confirmed payment reference does not exactly match this request.");
      }

      upsertUser(database, input.actor, reviewedAt);
      const status = input.decision === "Information" ? "INFORMATION_REQUESTED" : input.decision === "Approved" ? "APPROVED" : "REJECTED";
      const customerNote = input.decision === "Information"
        ? withReviewMessage(existing.customer_note, input.note)
        : existing.customer_note;
      database.prepare(`
        UPDATE licensing_access_requests SET
          status = ?, private_note = ?, customer_note = ?, reviewed_by_torn_id = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(status, input.note || null, customerNote, input.actor.tornUserId, reviewedAt, reviewedAt, existing.id);

      if (input.decision === "Approved") {
        const metadata = parseMetadata(existing.customer_note);
        const plan = input.plans.find((item) => item.id === metadata.planId);
        if (!plan) throw new Error("The stored request does not contain a recognized licence plan.");
        const conflicting = database.prepare(`
          SELECT reference FROM licensing_faction_licenses
          WHERE faction_id = ? AND status = 'ACTIVE' AND reference <> ? AND (expires_at IS NULL OR expires_at > ?)
          LIMIT 1
        `).get(existing.faction_id, existing.reference, reviewedAt) as unknown as { reference: string } | undefined;
        if (conflicting) throw new Error(`Faction access is already active under ${conflicting.reference}. Resolve that licence before approving another.`);

        const expiresAt = plan.durationDays === null
          ? null
          : new Date(input.reviewedAt.getTime() + plan.durationDays * 86_400_000).toISOString();
        const paymentNotes = `Manually matched ${plan.itemQuantity} ${plan.itemName} to ${existing.reference}.`;
        database.prepare(`
          INSERT INTO licensing_faction_licenses (
            id, faction_id, status, term, reference, issued_at, expires_at, approved_by_torn_id,
            payment_notes, internal_notes, created_at, updated_at
          ) VALUES (?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(reference) DO UPDATE SET
            status = 'ACTIVE', term = excluded.term, issued_at = excluded.issued_at,
            expires_at = excluded.expires_at, approved_by_torn_id = excluded.approved_by_torn_id,
            payment_notes = excluded.payment_notes, internal_notes = excluded.internal_notes,
            updated_at = excluded.updated_at
        `).run(randomUUID(), existing.faction_id, plan.licenseTerm, existing.reference, reviewedAt, expiresAt, input.actor.tornUserId, paymentNotes, input.note || null, reviewedAt, reviewedAt);
      }

      insertAudit(database, {
        factionId: existing.faction_id,
        actorTornUserId: input.actor.tornUserId,
        action: `ACCESS_REQUEST_${status}`,
        entityId: existing.id,
        metadata: {
          reference: existing.reference,
          decision: input.decision,
          submittedByTornId: existing.submitted_by_torn_id,
          paymentMatched: input.decision === "Approved",
        },
        createdAt: reviewedAt,
      });
      return { reviewedBy: { name: input.actor.name, tornUserId: input.actor.tornUserId } };
    });
  } finally {
    database.close();
  }
}

export function getLocalAccessRequestQueue(): AccessQueueResult {
  const database = requiredDatabase();
  try {
    const requests = database.prepare(`
      SELECT r.*, f.name AS faction_name, submitter.name AS submitted_by_name,
        reviewer.name AS reviewed_by_name
      FROM licensing_access_requests r
      JOIN licensing_factions f ON f.faction_id = r.faction_id
      JOIN licensing_users submitter ON submitter.torn_user_id = r.submitted_by_torn_id
      LEFT JOIN licensing_users reviewer ON reviewer.torn_user_id = r.reviewed_by_torn_id
      ORDER BY r.created_at DESC
    `).all() as unknown as RequestRow[];
    const factionCount = (database.prepare("SELECT COUNT(*) AS count FROM licensing_factions").get() as unknown as { count: number }).count;
    const now = new Date().toISOString();
    const licenses = database.prepare(`
      SELECT l.*, f.name AS faction_name, reviewer.name AS approved_by_name
      FROM licensing_faction_licenses l
      JOIN licensing_factions f ON f.faction_id = l.faction_id
      LEFT JOIN licensing_users reviewer ON reviewer.torn_user_id = l.approved_by_torn_id
      WHERE l.status = 'ACTIVE' AND (l.expires_at IS NULL OR l.expires_at > ?)
      ORDER BY l.issued_at DESC
    `).all(now) as unknown as LicenseRow[];
    const audits = database.prepare(`
      SELECT a.*, actor.name AS actor_name
      FROM licensing_audit a
      LEFT JOIN licensing_users actor ON actor.torn_user_id = a.actor_torn_user_id
      WHERE a.action LIKE 'ACCESS_REQUEST_%'
      ORDER BY a.created_at DESC LIMIT 12
    `).all() as unknown as AuditRow[];

    return {
      databaseConfigured: true,
      requests: requests.map(mapRequest),
      factionCount,
      activeLicenseCount: licenses.length,
      activeLicenses: licenses.map(mapLicense),
      auditEvents: audits.map(mapAudit),
      message: `${requests.length} local test access request${requests.length === 1 ? "" : "s"}.`,
    };
  } finally {
    database.close();
  }
}

export function getLocalFactionAccessSummary(tornFactionId: number): FactionAccessSummary {
  const database = requiredDatabase();
  try {
    const now = new Date().toISOString();
    const license = database.prepare(`
      SELECT reference, term, issued_at, expires_at
      FROM licensing_faction_licenses
      WHERE faction_id = ? AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY issued_at DESC LIMIT 1
    `).get(tornFactionId, now) as unknown as Pick<LicenseRow, "reference" | "term" | "issued_at" | "expires_at"> | undefined;
    if (license) return {
      state: "active",
      label: termLabel(license.term),
      expiresAt: license.expires_at,
      reference: license.reference,
      startedAt: license.issued_at,
      plan: license.term,
      payment: null,
      message: null,
    };

    const pending = database.prepare(`
      SELECT status, reference, customer_note, created_at
      FROM licensing_access_requests
      WHERE faction_id = ? AND status IN ('PENDING', 'INFORMATION_REQUESTED')
      ORDER BY created_at DESC LIMIT 1
    `).get(tornFactionId) as unknown as Pick<RequestRow, "status" | "reference" | "customer_note" | "created_at"> | undefined;
    if (pending) {
      const metadata = parseMetadata(pending.customer_note);
      return {
        state: "pending",
        label: pending.status === "INFORMATION_REQUESTED" ? "More information required" : "Owner review required",
        expiresAt: null,
        reference: pending.reference,
        startedAt: pending.created_at,
        plan: metadata.plan,
        payment: metadata.price,
        message: metadata.reviewMessage,
      };
    }
    return inactive();
  } finally {
    database.close();
  }
}

function requiredDatabase(): DatabaseSync {
  const database = openLocalTestDatabase();
  if (!database) throw new Error("Create the local test database before using the unlock workflow.");
  return database;
}

function transaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function upsertUser(database: DatabaseSync, actor: PlatformActor, timestamp: string): void {
  database.prepare(`
    INSERT INTO licensing_users (torn_user_id, name, is_platform_admin, last_authenticated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(torn_user_id) DO UPDATE SET
      name = excluded.name,
      is_platform_admin = excluded.is_platform_admin,
      last_authenticated_at = excluded.last_authenticated_at
  `).run(actor.tornUserId, actor.name, actor.isPlatformAdmin ? 1 : 0, timestamp);
}

function insertAudit(database: DatabaseSync, event: {
  factionId: number;
  actorTornUserId: number;
  action: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}): void {
  database.prepare(`
    INSERT INTO licensing_audit (
      id, faction_id, actor_torn_user_id, action, entity_type, entity_id, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, 'AccessRequest', ?, ?, ?)
  `).run(randomUUID(), event.factionId, event.actorTornUserId, event.action, event.entityId, JSON.stringify(event.metadata), event.createdAt);
}

function mapRequest(row: RequestRow): AccessRequestView {
  const metadata = parseMetadata(row.customer_note);
  return {
    requestId: row.id,
    faction: row.faction_name,
    factionId: row.faction_id,
    contact: { name: row.submitted_by_name, tornUserId: row.submitted_by_torn_id },
    reference: row.reference,
    submittedAt: row.created_at,
    status: mapStatus(row.status),
    plan: metadata.plan ?? "Not recorded",
    planId: metadata.planId,
    payment: metadata.price ?? "Not recorded",
    term: metadata.term ?? "Not recorded",
    reviewedBy: row.reviewed_by_torn_id && row.reviewed_by_name
      ? { name: row.reviewed_by_name, tornUserId: row.reviewed_by_torn_id }
      : null,
    reviewedAt: row.reviewed_at,
    privateNote: row.private_note,
  };
}

function mapLicense(row: LicenseRow): ActiveLicenseView {
  return {
    licenseId: row.id,
    faction: row.faction_name,
    factionId: row.faction_id,
    reference: row.reference,
    term: termLabel(row.term),
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    approvedBy: row.approved_by_torn_id && row.approved_by_name
      ? { name: row.approved_by_name, tornUserId: row.approved_by_torn_id }
      : null,
  };
}

function mapAudit(row: AuditRow): AccessAuditView {
  return {
    id: row.id,
    action: auditLabel(row.action),
    reference: auditReference(row.metadata_json),
    actor: row.actor_torn_user_id && row.actor_name
      ? { name: row.actor_name, tornUserId: row.actor_torn_user_id }
      : null,
    createdAt: row.created_at,
  };
}

function mapStatus(status: string): AccessRequestViewStatus {
  if (status === "INFORMATION_REQUESTED") return "Information";
  if (status === "APPROVED") return "Approved";
  if (status === "REJECTED") return "Rejected";
  if (status === "CANCELLED") return "Cancelled";
  return "Pending";
}

function termLabel(term: string): string {
  if (term === "PERMANENT") return "Lifetime access";
  if (term === "YEARLY") return "Annual access";
  if (term === "QUARTERLY") return "Quarterly access";
  if (term === "MONTHLY") return "Monthly access";
  return "Faction access";
}

function auditLabel(action: string): string {
  return action.replace("ACCESS_REQUEST_", "").toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function auditReference(value: string | null): string | null {
  try {
    const parsed = JSON.parse(value ?? "{}") as Record<string, unknown>;
    return typeof parsed.reference === "string" ? parsed.reference : null;
  } catch {
    return null;
  }
}

function parseMetadata(value: string | null): {
  planId: string;
  plan: string | null;
  price: string | null;
  term: string | null;
  reviewMessage: string | null;
} {
  try {
    const parsed = JSON.parse(value ?? "{}") as Record<string, unknown>;
    return {
      planId: typeof parsed.planId === "string" ? parsed.planId : "unknown",
      plan: typeof parsed.plan === "string" ? parsed.plan : null,
      price: typeof parsed.price === "string" ? parsed.price : null,
      term: typeof parsed.term === "string" ? parsed.term : null,
      reviewMessage: typeof parsed.reviewMessage === "string" ? parsed.reviewMessage : null,
    };
  } catch {
    return { planId: "unknown", plan: null, price: null, term: null, reviewMessage: null };
  }
}

function withReviewMessage(value: string | null, reviewMessage: string): string {
  try {
    const parsed = JSON.parse(value ?? "{}") as Record<string, unknown>;
    return JSON.stringify({ ...parsed, reviewMessage });
  } catch {
    return JSON.stringify({ reviewMessage });
  }
}

function inactive(): FactionAccessSummary {
  return { state: "inactive", label: "Faction-wide licence", expiresAt: null, reference: null, startedAt: null, plan: null, payment: null, message: null };
}
