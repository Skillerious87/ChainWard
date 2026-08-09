"use client";

import { BadgeCheck, Check, CircleHelp, ClipboardCheck, Copy, Fingerprint, MessageCircleQuestion, Search, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { reviewAccessRequest } from "@/app/(platform)/admin/actions";
import { Dialog } from "@/components/ui/dialog";
import { TornUserName } from "@/components/ui/torn-user-link";
import { notify } from "@/lib/client-actions";
import type { AccessRequestView, AccessRequestViewStatus } from "@/lib/licensing/request-store";

type QueueView = "Review" | "Approved" | "All";
type ReviewDecision = "Approved" | "Information" | "Rejected";

export function AccessRequestTable({ initialRequests, databaseConfigured, message }: { initialRequests: AccessRequestView[]; databaseConfigured: boolean; message: string }) {
  const router = useRouter();
  const [requests, setRequests] = useState(initialRequests);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<QueueView>("Review");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decision, setDecision] = useState<ReviewDecision>("Approved");
  const [note, setNote] = useState("");
  const [paymentMatched, setPaymentMatched] = useState(false);
  const [referenceConfirmation, setReferenceConfirmation] = useState("");
  const selected = requests.find((request) => request.requestId === selectedId) ?? null;
  const reviewCount = requests.filter((request) => request.status === "Pending" || request.status === "Information").length;
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return requests.filter((request) => {
      const matchesView = view === "All" || request.status === view || (view === "Review" && (request.status === "Pending" || request.status === "Information"));
      const searchable = `${request.requestId} ${request.faction} ${request.contact.name} ${request.contact.tornUserId} ${request.reference}`.toLowerCase();
      return matchesView && (!normalized || searchable.includes(normalized));
    });
  }, [query, requests, view]);

  function openReview(requestId: string, nextDecision: ReviewDecision): void {
    setSelectedId(requestId);
    setDecision(nextDecision);
    setNote("");
    setPaymentMatched(false);
    setReferenceConfirmation("");
  }

  function closeReview(): void {
    setSelectedId(null);
    setNote("");
    setPaymentMatched(false);
    setReferenceConfirmation("");
  }

  async function decide(): Promise<void> {
    if (!selected) return;
    try {
      const result = await reviewAccessRequest({ requestId: selected.requestId, decision, note, paymentMatched, referenceConfirmation });
      setRequests((current) => current.map((item) => item.requestId === selected.requestId ? { ...item, status: result.status, reviewedBy: result.reviewedBy, reviewedAt: result.reviewedAt, privateNote: note || null } : item));
      window.dispatchEvent(new CustomEvent("chainward:license-reviewed", { detail: { decision } }));
      router.refresh();
      notify({ title: decision === "Approved" ? "Faction licence activated" : decision === "Information" ? "Information request recorded" : "Request rejected", description: `Stored by ${result.reviewedBy.name} with an audit event.`, tone: decision === "Rejected" ? "warning" : "success" });
      closeReview();
    } catch (error) {
      notify({ title: "Review was not saved", description: error instanceof Error ? error.message : "The database action failed.", tone: "danger" });
      throw error;
    }
  }

  async function copyIdentifier(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      notify({ title: "Identifier copied", description: value, tone: "success" });
    } catch {
      notify({ title: "Copy blocked", description: `Copy ${value} manually.`, tone: "warning" });
    }
  }

  const approvalReady = Boolean(selected && paymentMatched && referenceConfirmation === selected.reference);
  const noteReady = note.trim().length >= 3;

  return <>
    <section className="data-section admin-requests">
      <div className="section-heading admin-request-heading">
        <div><h2>Faction access queue</h2><p>{databaseConfigured ? `${reviewCount} stored request${reviewCount === 1 ? "" : "s"} require review` : message}</p></div>
        <div className="admin-request-tools">
          <div className="segmented-control" aria-label="Access request view">{(["Review", "Approved", "All"] as const).map((item) => <button key={item} className={view === item ? "segmented-control__active" : undefined} onClick={() => setView(item)}>{item}{item === "Review" && <span>{reviewCount}</span>}</button>)}</div>
          <label className="search-field"><Search size={15} /><span className="sr-only">Search requests</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Faction, player, or identifier" /></label>
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table access-request-table">
          <thead><tr><th>Faction</th><th>Plan</th><th>Submitted by</th><th>Payment identifier</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{visible.map((request) => <tr key={request.requestId}>
            <td><strong>{request.faction}</strong><small className="cell-subtext">Torn faction ID {request.factionId}</small></td>
            <td><strong>{request.plan}</strong><small className="cell-subtext">{request.payment} · {request.term}</small></td>
            <td><TornUserName name={request.contact.name} tornUserId={request.contact.tornUserId} /><small className="cell-subtext">Request {shortId(request.requestId)}</small></td>
            <td><span className="identifier-cell"><code className="reference-code">{request.reference}</code><button onClick={() => void copyIdentifier(request.reference)} aria-label={`Copy ${request.reference}`}><Copy size={12} /></button></span><small className="cell-subtext">{new Date(request.submittedAt).toLocaleString("en-GB")}</small></td>
            <td><span className={`payout-badge payout-badge--${statusClass(request.status)}`}>{request.status === "Approved" && <Check size={12} />}{request.status}</span>{request.reviewedBy && <small className="cell-subtext">by <TornUserName name={request.reviewedBy.name} tornUserId={request.reviewedBy.tornUserId} /></small>}</td>
            <td><div className="access-row-actions">{(request.status === "Pending" || request.status === "Information") && <><button className="button access-approve-button" onClick={() => openReview(request.requestId, "Approved")}><ShieldCheck size={14} /> Review payment</button><button className="icon-button" onClick={() => openReview(request.requestId, "Information")} title="Request information" aria-label={`Request information from ${request.faction}`}><MessageCircleQuestion size={15} /></button><button className="icon-button access-reject-button" onClick={() => openReview(request.requestId, "Rejected")} title="Reject request" aria-label={`Reject ${request.faction}`}><X size={15} /></button></>}</div></td>
          </tr>)}</tbody>
        </table>
        {visible.length === 0 && <div className="table-empty">{databaseConfigured ? "No stored access requests match this view." : "Connect PostgreSQL to accept and review licence requests."}</div>}
      </div>
      <div className="table-footer"><span title="Torn user ID 3212954"><ShieldCheck size={12} /> Only Skillerious can change licence state</span><span>{message}</span></div>
    </section>

    <Dialog open={selected !== null} className={`dialog--access-review dialog--access-review-${decision.toLowerCase()}`} title={dialogTitle(decision, selected?.faction)} description={dialogDescription(decision)} confirmLabel={decision === "Approved" ? "Activate faction licence" : decision === "Information" ? "Save information request" : "Reject access request"} destructive={decision === "Rejected"} confirmDisabled={decision === "Approved" ? !approvalReady : !noteReady} onConfirm={decide} onClose={closeReview}>
      {selected && <div className="professional-access-review">
        <div className="access-review-identity"><span>{decision === "Approved" ? <ClipboardCheck size={22} /> : decision === "Information" ? <CircleHelp size={22} /> : <X size={22} />}</span><div><p className="eyebrow">Request {shortId(selected.requestId)}</p><h3>{selected.faction} [{selected.factionId}]</h3><p>Submitted by <TornUserName name={selected.contact.name} tornUserId={selected.contact.tornUserId} /> on {new Date(selected.submittedAt).toLocaleString("en-GB")}.</p></div></div>
        <dl className="access-review-facts"><div><dt>Requested plan</dt><dd>{selected.plan} · {selected.term}</dd></div><div><dt>Expected Torn items</dt><dd>{selected.payment}</dd></div><div><dt>Exact identifier</dt><dd><code>{selected.reference}</code><button onClick={() => void copyIdentifier(selected.reference)}><Copy size={12} /> Copy</button></dd></div></dl>
        {decision === "Approved" ? <div className="access-verification-checklist">
          <header><Fingerprint size={17} /><div><strong>Manual transfer verification</strong><small>Chainward cannot inspect Torn item transfers automatically.</small></div></header>
          <label><input type="checkbox" checked={paymentMatched} onChange={(event) => setPaymentMatched(event.target.checked)} /><span>{paymentMatched && <Check size={13} />}</span><p><strong>I found the item transfer in Torn</strong><small>The sender and quantity match {selected.contact.name} and {selected.payment}.</small></p></label>
          <label className="reference-confirmation"><span>Type the exact identifier to confirm</span><input value={referenceConfirmation} onChange={(event) => setReferenceConfirmation(event.target.value.toUpperCase())} placeholder={selected.reference} autoComplete="off" spellCheck={false} /><small className={referenceConfirmation && referenceConfirmation !== selected.reference ? "reference-confirmation__mismatch" : undefined}>{referenceConfirmation === selected.reference ? <><BadgeCheck size={12} /> Exact match</> : "Approval remains locked until this matches."}</small></label>
        </div> : <label className="access-review-note"><span>{decision === "Information" ? "Message shown to the requesting faction" : "Private rejection reason"}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder={decision === "Information" ? "Describe exactly what must be clarified before approval…" : "Record why this request cannot be approved…"} /><small>{note.length}/500 · {decision === "Information" ? "visible on their pending-access page" : "stored for owner review"}</small></label>}
        {decision === "Approved" && <label className="access-review-note"><span>Optional private note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Example: Transfer reviewed in Torn at 20:45 TCT." /><small>{note.length}/500 · not shown to faction members</small></label>}
        <div className="approval-check"><span><ShieldCheck size={16} /></span><p><strong>Server-side owner authorization</strong><small>The final database transaction rechecks the owner identity, request state, reference, conflicting licences, and selected plan before activation.</small></p></div>
      </div>}
    </Dialog>
  </>;
}

function shortId(id: string): string { return id.slice(0, 8).toUpperCase(); }
function dialogTitle(decision: ReviewDecision, faction?: string): string { return decision === "Approved" ? `Review ${faction ?? "faction"} payment` : decision === "Information" ? "Request more information" : `Reject ${faction ?? "faction"} request?`; }
function dialogDescription(decision: ReviewDecision): string { return decision === "Approved" ? "Match the transfer to both immutable identifiers before activating access." : decision === "Information" ? "Keep the request open while documenting what needs clarification." : "This closes the request without creating a licence."; }
function statusClass(status: AccessRequestViewStatus): string { return status === "Pending" ? "pending" : status === "Rejected" || status === "Cancelled" ? "held" : status === "Approved" ? "paid" : "approved"; }
