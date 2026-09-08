import { ArrowRight, ClipboardCheck, CreditCard, ShieldCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import type { FactionAccessRequest } from "@/lib/auth/faction-access-store";
import type { AccessRequestView } from "@/lib/licensing/request-store";

interface ReviewRow {
  key: string;
  icon: "licence" | "member";
  eyebrow: string;
  title: string;
  at: string;
  href: "/admin#requests" | "/admin#members";
}

/** The Overview tab's answer to "who is waiting on me" — every pending licence
 *  and member request in one place, each linking straight to the tab that can
 *  actually act on it. Both queues already live server-side in `admin/page.tsx`
 *  for their own tables, so this adds no new fetch. */
export function AdminReviewQueue({ licenceRequests, memberRequests }: { licenceRequests: AccessRequestView[]; memberRequests: FactionAccessRequest[] }) {
  const rows: ReviewRow[] = [
    ...licenceRequests
      .filter((request) => request.status === "Pending" || request.status === "Information")
      .map((request) => ({ key: `licence-${request.requestId}`, icon: "licence" as const, eyebrow: `Licence request · ${request.plan}`, title: request.faction, at: request.submittedAt, href: "/admin#requests" as const })),
    ...memberRequests.map((request) => ({ key: `member-${request.tornUserId}`, icon: "member" as const, eyebrow: "Workspace access request", title: request.memberName, at: request.requestedAt, href: "/admin#members" as const })),
  ].toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <section className="panel admin-review-queue" aria-labelledby="admin-review-queue-title">
      <div className="section-heading">
        <div>
          <h2 id="admin-review-queue-title">Needs your review</h2>
          <p>{rows.length ? `${rows.length} item${rows.length === 1 ? "" : "s"} waiting across licence and member requests.` : "Nothing is waiting on you right now."}</p>
        </div>
        <span className="analytics-panel-icon"><ClipboardCheck size={17} /></span>
      </div>
      {rows.length > 0 ? (
        <div className="admin-review-queue__list">
          {rows.map((row) => (
            <Link key={row.key} href={row.href} className="admin-member-approvals">
              <span>{row.icon === "licence" ? <CreditCard size={18} /> : <UsersRound size={18} />}</span>
              <div>
                <p className="eyebrow">{row.eyebrow}</p>
                <strong>{row.title}</strong>
                <small>{formatWhen(row.at)}</small>
              </div>
              <em><ArrowRight size={13} /> Review</em>
            </Link>
          ))}
        </div>
      ) : (
        <div className="queue-empty">
          <span><ShieldCheck size={22} /></span>
          <strong>Queue clear</strong>
          <p>New faction licence and member access requests will appear here the moment they&apos;re submitted.</p>
        </div>
      )}
    </section>
  );
}

function formatWhen(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}
