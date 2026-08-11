import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { AccessRequestTable } from "@/components/admin/access-request-table";
import { AdminKpis } from "@/components/admin/admin-kpis";
import { ServiceHealthPanel } from "@/components/admin/service-health-panel";
import { AccessAuditTimeline, LicenseRegistry, PurchaseReviewGuide } from "@/components/admin/license-operations";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { isPlatformOwner, PLATFORM_OWNER } from "@/lib/auth/platform-owner";
import { getDatabaseStatus } from "@/lib/data/database-status";
import { getAccessRequestQueue } from "@/lib/licensing/request-store";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const metadata: Metadata = { title: "Platform Administration" };

export default async function AdminPage() {
  const actor = await getCurrentActor();
  if (!isPlatformOwner(actor)) notFound();
  const [queue, telemetry, database] = await Promise.all([getAccessRequestQueue(), getWorkspaceTelemetry(), getDatabaseStatus()]);
  const reviewCount = queue.requests.filter((request) => request.status === "Pending" || request.status === "Information").length;

  return (
    <div className="admin-console admin-page">
      {/* Identity, standing, and the one number that decides whether there is
          work to do all sit in the masthead, so the queue starts near the top
          of the view instead of below three stacked banners. */}
      <header className="admin-masthead">
        <span className="admin-masthead__crest"><ShieldCheck size={20} /></span>
        <div className="admin-masthead__identity">
          <p className="eyebrow">Owner console</p>
          <h1>Access management</h1>
          <p>Approve faction licences, review payment references, and oversee platform service activity.</p>
        </div>
        <div className="admin-masthead__side">
          <a className="admin-owner-chip" href={PLATFORM_OWNER.profileUrl} target="_blank" rel="noreferrer">
            <span>{PLATFORM_OWNER.name.slice(0, 2).toUpperCase()}</span>
            <div><strong>{PLATFORM_OWNER.name}</strong><small>Torn ID {PLATFORM_OWNER.tornUserId}</small></div>
          </a>
          <p className={`admin-queue-flag admin-queue-flag--${reviewCount ? "action" : "clear"}`}>
            {reviewCount ? `${reviewCount} awaiting review` : "Queue clear"}
          </p>
        </div>
      </header>

      <AdminKpis factionCount={queue.factionCount} activeLicenseCount={queue.activeLicenseCount} reviewCount={reviewCount} telemetry={telemetry} />

      {/* The queue is the work and takes the wide column; service state is a
          three-row readout and fits the rail. Stacking the four-step procedure
          under it made the rail run far past the queue and left a dead column
          on the left, so the procedure now spans the full width where its
          columns can actually breathe. */}
      <div className="admin-grid">
        <AccessRequestTable initialRequests={queue.requests} databaseConfigured={queue.databaseConfigured} message={queue.message} />
        <ServiceHealthPanel telemetry={telemetry} database={database} />
      </div>

      <PurchaseReviewGuide />

      <div className="admin-records-grid"><LicenseRegistry licenses={queue.activeLicenses} /><AccessAuditTimeline events={queue.auditEvents} /></div>
    </div>
  );
}
