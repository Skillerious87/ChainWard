import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
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
    <div className="page-stack admin-page">
      <PageHeader eyebrow="Skillerious owner console" title="Access management" description="Approve faction licences, review payment references, and oversee platform-wide service activity." />
      <div className="admin-owner-banner"><span><ShieldCheck size={17} /></span><div><strong>Owner-restricted workspace</strong><small>Authenticated as {PLATFORM_OWNER.name} [{PLATFORM_OWNER.tornUserId}] · Approval actions are server-authorized and audit-ready.</small></div><a href={PLATFORM_OWNER.profileUrl} target="_blank" rel="noreferrer">View Torn identity ↗</a></div>
      <AdminKpis factionCount={queue.factionCount} activeLicenseCount={queue.activeLicenseCount} reviewCount={reviewCount} telemetry={telemetry} />
      <PurchaseReviewGuide />
      <div className="admin-grid">
        <AccessRequestTable initialRequests={queue.requests} databaseConfigured={queue.databaseConfigured} message={queue.message} />
        <ServiceHealthPanel telemetry={telemetry} database={database} />
      </div>
      <div className="admin-records-grid"><LicenseRegistry licenses={queue.activeLicenses} /><AccessAuditTimeline events={queue.auditEvents} /></div>
    </div>
  );
}
