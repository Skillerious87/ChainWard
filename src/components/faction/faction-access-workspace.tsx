"use client";

import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Check,
  ChevronsUpDown,
  CircleSlash2,
  Clock3,
  Copy,
  ExternalLink,
  KeyRound,
  LayoutList,
  LockKeyhole,
  Search,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  UserCog,
  UserRoundX,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { removeFactionMemberAccess, updateFactionMemberAccess, updateFactionMemberAccessBatch } from "@/app/(platform)/faction/actions";
import { ExportButton } from "@/components/ui/action-controls";
import { Dialog } from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { TornUserLink, TornUserName } from "@/components/ui/torn-user-link";
import { notify } from "@/lib/client-actions";
import { analyzeAccessChange, analyzeAccessPosture } from "@/lib/auth/access-intelligence";
import { roleDefinitions, roleLabel } from "@/lib/auth/authorization";
import type { FactionAccessAssignment, FactionAccessWorkspace, ManagedAccessStatus, ManagedFactionRole } from "@/lib/auth/faction-access-store";
import { summarizeRoster } from "@/lib/intelligence/analytics";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";
import type { TornDataResult, TornRosterMember } from "@/lib/torn/workspace-types";

type RosterView = "all" | "recent" | "attention" | "assigned";
type AccessView = "directory" | "assignments" | "roles" | "audit";
type SortKey = "activity" | "name" | "level" | "tenure" | "access";
const pageSize = 15;
/** Mirrors the server-side cap in `updateFactionMemberAccessBatch`. */
const bulkLimit = 50;

/**
 * Roles and their permissions come from the same table the server enforces, so
 * this screen cannot advertise a capability a role does not actually hold.
 */
const roleOptions = roleDefinitions;

interface RevokeTarget {
  tornUserId: number;
  name: string;
  inRoster: boolean;
}

export function FactionAccessWorkspace({ telemetry, rosterResult, access, canManage }: { telemetry: WorkspaceTelemetry; rosterResult: TornDataResult<TornRosterMember[]>; access: FactionAccessWorkspace; canManage: boolean }) {
  const router = useRouter();
  const roster = rosterResult.data;
  const faction = telemetry.faction;
  const summary = useMemo(() => summarizeRoster(roster, rosterResult.checkedAt), [roster, rosterResult.checkedAt]);
  const assignmentById = useMemo(() => new Map(access.assignments.map((assignment) => [assignment.tornUserId, assignment])), [access.assignments]);
  const [query, setQuery] = useState("");
  const [accessView, setAccessView] = useState<AccessView>("directory");
  const [assignmentQuery, setAssignmentQuery] = useState("");
  const [assignmentStatus, setAssignmentStatus] = useState<"ALL" | ManagedAccessStatus>("ALL");
  const [view, setView] = useState<RosterView>("all");
  const [position, setPosition] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("activity");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<TornRosterMember | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null);
  const [draftRole, setDraftRole] = useState<ManagedFactionRole>("VIEWER");
  const [draftStatus, setDraftStatus] = useState<ManagedAccessStatus>("ACTIVE");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkRole, setBulkRole] = useState<ManagedFactionRole>("VIEWER");
  const [bulkStatus, setBulkStatus] = useState<ManagedAccessStatus>("ACTIVE");
  const [bulkWorking, setBulkWorking] = useState(false);
  const positions = useMemo(() => ["All", ...[...new Set(roster.map((member) => member.position || "Unassigned"))].toSorted()], [roster]);
  const checkedAtSeconds = Math.floor(Date.parse(rosterResult.checkedAt) / 1_000);
  const activeAssignments = access.assignments.filter((assignment) => assignment.status === "ACTIVE").length;
  const rosterIds = useMemo(() => new Set(roster.map((member) => member.tornId)), [roster]);
  const accessPosture = useMemo(() => analyzeAccessPosture(access.assignments, rosterIds, rosterResult.available, access.databaseAvailable), [access.assignments, access.databaseAvailable, rosterIds, rosterResult.available]);
  /**
   * An assignment whose holder is no longer on the verified roster. The server
   * refuses these at permission-check time, but the row survives until somebody
   * revokes it, so it is surfaced here rather than left to be discovered.
   */
  const staleAssignments = useMemo(
    () => (rosterResult.available ? access.assignments.filter((assignment) => !rosterIds.has(assignment.tornUserId)) : []),
    [access.assignments, rosterIds, rosterResult.available],
  );
  const filteredAssignments = useMemo(() => {
    const normalized = assignmentQuery.trim().toLowerCase();
    return access.assignments.filter((assignment) => (assignmentStatus === "ALL" || assignment.status === assignmentStatus) && (!normalized || assignment.memberName.toLowerCase().includes(normalized) || String(assignment.tornUserId).includes(normalized) || roleLabel(assignment.role).toLowerCase().includes(normalized)));
  }, [access.assignments, assignmentQuery, assignmentStatus]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return roster.filter((member) => {
      const assignment = assignmentById.get(member.tornId);
      const matchesQuery = !normalized || member.name.toLowerCase().includes(normalized) || String(member.tornId).includes(normalized) || member.position.toLowerCase().includes(normalized);
      const matchesPosition = position === "All" || (member.position || "Unassigned") === position;
      const matchesView = view === "all"
        || (view === "recent" && member.lastActionAt >= checkedAtSeconds - 15 * 60)
        || (view === "attention" && member.status.toLowerCase() !== "okay")
        || (view === "assigned" && Boolean(assignment));
      return matchesQuery && matchesPosition && matchesView;
    }).toSorted((left, right) => compareMembers(left, right, sortKey, assignmentById));
  }, [assignmentById, checkedAtSeconds, position, query, roster, sortKey, view]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const visibleSelectableIds = visible.map((member) => member.tornId);
  const allVisibleSelected = visibleSelectableIds.length > 0 && visibleSelectableIds.every((tornUserId) => selectedIds.has(tornUserId));
  const selectedAssignment = selected ? assignmentById.get(selected.tornId) ?? null : null;
  const accessImpact = selected ? analyzeAccessChange(selectedAssignment, { role: draftRole, status: draftStatus }) : null;
  const bulkChangedIds = [...selectedIds].filter((tornUserId) => {
    const current = assignmentById.get(tornUserId);
    return !current || current.role !== bulkRole || current.status !== bulkStatus;
  });

  function changeView(next: RosterView): void { setView(next); setPage(0); }
  function inspect(member: TornRosterMember): void {
    const assignment = assignmentById.get(member.tornId);
    setDraftRole(assignment?.role ?? "VIEWER");
    setDraftStatus(assignment?.status ?? "ACTIVE");
    setSelected(member);
  }

  async function saveAccess(): Promise<void> {
    if (!selected || !faction) return;
    if (!accessImpact?.changed) {
      notify({ title: "Access already matches", description: "No access record or audit event was changed.", tone: "info", dedupeKey: `access-noop:${selected.tornId}` });
      return;
    }
    const result = await updateFactionMemberAccess({ factionId: faction.id, tornUserId: selected.tornId, role: draftRole, status: draftStatus });
    notify({ title: result.ok ? "Access registry updated" : "Access was not changed", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
    router.refresh();
  }

  async function revokeAccess(): Promise<void> {
    if (!revokeTarget || !faction) return;
    const result = await removeFactionMemberAccess({ factionId: faction.id, tornUserId: revokeTarget.tornUserId });
    notify({ title: result.ok ? "Access revoked" : "Access was not changed", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
    setRevokeTarget(null);
    router.refresh();
  }

  function toggleSelected(tornUserId: number, checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!checked) next.delete(tornUserId);
      else if (next.size < bulkLimit) next.add(tornUserId);
      else notify({ title: "Selection limit reached", description: `Bulk access changes are limited to ${bulkLimit} verified members at a time.`, tone: "warning" });
      return next;
    });
  }

  function toggleVisible(checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      let capped = false;
      for (const tornUserId of visibleSelectableIds) {
        if (!checked) next.delete(tornUserId);
        else if (next.size < bulkLimit) next.add(tornUserId);
        else capped = true;
      }
      if (capped) notify({ title: "Selection limit reached", description: `Only the first ${bulkLimit} members were selected. Apply this batch, then select the rest.`, tone: "warning" });
      return next;
    });
  }

  async function saveBulkAccess(): Promise<void> {
    if (!faction || !selectedIds.size) return;
    if (!bulkChangedIds.length) {
      notify({ title: "Everyone already matches", description: "No access records or audit events were changed.", tone: "info", dedupeKey: "access-bulk-noop" });
      return;
    }
    setBulkWorking(true);
    try {
      const result = await updateFactionMemberAccessBatch({ factionId: faction.id, tornUserIds: bulkChangedIds, role: bulkRole, status: bulkStatus });
      notify({ title: result.ok ? "Bulk access updated" : "Bulk access was not changed", description: result.message, tone: result.ok ? "success" : "danger" });
      if (!result.ok) return;
      setSelectedIds(new Set());
      router.refresh();
    } finally { setBulkWorking(false); }
  }

  async function copyTornId(tornId: number): Promise<void> {
    try {
      await navigator.clipboard.writeText(String(tornId));
      notify({ title: "Torn ID copied", description: `${tornId} is ready to paste.`, tone: "success" });
    } catch {
      notify({ title: "Torn ID not copied", description: "Clipboard access is unavailable in this browser context.", tone: "warning" });
    }
  }

  return <div className="page-stack faction-access-workspace">
    <PageHeader eyebrow="Workspace security" title="Faction access" description="Inspect verified roster readiness and control who can operate Chainward for this faction." actions={<ExportButton filename="chainward-faction-access.csv" label="Export roster" rows={filtered.map((member) => { const assignment = assignmentById.get(member.tornId); return { name: member.name, tornId: member.tornId, factionPosition: member.position, level: member.level, daysInFaction: member.daysInFaction, lastAction: member.lastAction, tornStatus: member.status, applicationRole: assignment ? roleLabel(assignment.role) : "None", accessStatus: assignment?.status ?? "None" }; })} />} />

    <section className="faction-command-hero">
      <span className="faction-command-hero__mark">{faction?.tag?.slice(0, 2).toUpperCase() || "—"}</span>
      <div className="faction-command-hero__identity"><p className="eyebrow">Verified Torn faction</p><h2>{faction?.name ?? "Faction unavailable"}</h2>{faction && <a href={`https://www.torn.com/factions.php?step=profile&ID=${faction.id}`} target="_blank" rel="noreferrer">Open Torn profile <ExternalLink size={13} /></a>}</div>
      <dl><div><dt>Faction ID</dt><dd>{faction?.id ?? "—"}</dd></div><div><dt>Roster coverage</dt><dd>{rosterResult.available ? `${roster.length} members` : "Unavailable"}</dd></div><div><dt>Positions</dt><dd>{summary.positions.length}</dd></div><div><dt>Last verified</dt><dd>{formatCheckedAt(rosterResult.checkedAt)}</dd></div></dl>
      <span className={`faction-command-hero__state faction-command-hero__state--${telemetry.source}`}><i />{telemetry.source === "live" ? "API verified" : "Unavailable"}</span>
    </section>

    <section className="access-stat-grid">
      <AccessStat icon={UsersRound} label="Faction roster" value={rosterResult.available ? roster.length.toLocaleString() : "—"} detail="Verified current members" />
      <AccessStat icon={Activity} label="Active in 15m" value={rosterResult.available ? summary.active15Minutes.toLocaleString() : "—"} detail={`${summary.activeHour} active in the last hour`} />
      <AccessStat icon={BadgeCheck} label="Status Okay" value={rosterResult.available ? `${summary.okayPercent.toFixed(0)}%` : "—"} detail={`${summary.okay} of ${summary.total} members`} />
      <AccessStat icon={KeyRound} label="Application access" value={access.databaseAvailable ? activeAssignments.toLocaleString() : "—"} detail={`${access.assignments.length - activeAssignments} suspended · ${access.message}`} />
    </section>

    <section className={`access-intelligence access-intelligence--${accessPosture.tone}`} role="status">
      <span className="access-intelligence__icon">{accessPosture.tone === "healthy" ? <ShieldCheck size={19} /> : <AlertTriangle size={19} />}</span>
      <div><p className="eyebrow">Access intelligence</p><strong>{accessPosture.title}</strong><small>{accessPosture.detail}</small></div>
      <dl>
        <div><dt>Administrators</dt><dd>{accessPosture.administratorCount}</dd></div>
        <div><dt>Suspended</dt><dd>{accessPosture.suspendedCount}</dd></div>
        <div><dt>Stale</dt><dd>{accessPosture.staleCount}</dd></div>
      </dl>
      <button className="button button--quiet" onClick={() => setAccessView(accessPosture.action)}>{accessPosture.actionLabel}</button>
    </section>

    <nav className="access-workspace-nav" aria-label="Access management views">
      <AccessViewButton icon={LayoutList} label="Member directory" description="Search and grant access" count={roster.length} active={accessView === "directory"} onClick={() => setAccessView("directory")} />
      <AccessViewButton icon={KeyRound} label="Assignments" description="Review managed access" count={access.assignments.length} active={accessView === "assignments"} onClick={() => setAccessView("assignments")} />
      <AccessViewButton icon={ShieldCheck} label="Role policy" description="Compare permissions" count={roleOptions.length} active={accessView === "roles"} onClick={() => setAccessView("roles")} />
      <AccessViewButton icon={ScrollText} label="Audit history" description="Trace access changes" count={access.audit.length} active={accessView === "audit"} onClick={() => setAccessView("audit")} />
    </nav>

    {accessView === "assignments" && <section className="panel access-registry-panel">
      <div className="section-heading access-registry-heading"><div><h2>Managed application access</h2><p>Explicit Chainward roles · never inferred from Torn positions</p></div><div className="table-tools"><label className="search-field"><Search size={15} /><span className="sr-only">Search access assignments</span><input value={assignmentQuery} onChange={(event) => setAssignmentQuery(event.target.value)} placeholder="Member, role, or Torn ID" /></label><label className="access-position-filter"><SlidersHorizontal size={14} /><span className="sr-only">Access status</span><select value={assignmentStatus} onChange={(event) => setAssignmentStatus(event.target.value as "ALL" | ManagedAccessStatus)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select></label><span className={`registry-state registry-state--${access.databaseAvailable ? "ready" : "attention"}`}><i />{access.databaseAvailable ? "Registry ready" : "Storage required"}</span></div></div>
      {staleAssignments.length > 0 && <div className="access-stale-banner" role="status">
        <span><UserRoundX size={17} /></span>
        <div>
          <strong>{staleAssignments.length} assignment{staleAssignments.length === 1 ? "" : "s"} held by {staleAssignments.length === 1 ? "someone" : "people"} outside the roster</strong>
          <p>Chainward already refuses these at sign-in, because permission checks re-verify current faction membership. Revoke them to keep the registry truthful.</p>
        </div>
        <ul>{staleAssignments.map((assignment) => <li key={assignment.tornUserId}>
          <TornUserName name={assignment.memberName} tornUserId={assignment.tornUserId} />
          <span className={`access-role access-role--${assignment.role.toLowerCase()}`}>{roleLabel(assignment.role)}</span>
          <button className="button button--quiet" disabled={!canManage} onClick={() => setRevokeTarget({ tornUserId: assignment.tornUserId, name: assignment.memberName, inRoster: false })}>{canManage ? "Revoke" : "Restricted"}</button>
        </li>)}</ul>
      </div>}

      {filteredAssignments.length ? <div className="access-assignment-list">{filteredAssignments.map((assignment) => {
        const member = roster.find((item) => item.tornId === assignment.tornUserId);
        const stale = rosterResult.available && !member;
        return <article key={assignment.tornUserId} className={stale ? "access-assignment--stale" : undefined}>
          <MemberAvatar name={assignment.memberName} />
          <TornUserName name={assignment.memberName} tornUserId={assignment.tornUserId} detail={stale ? "No longer in the verified roster" : `Updated ${formatAuditTime(assignment.updatedAt)}`} />
          <span className={`access-role access-role--${assignment.role.toLowerCase()}`}>{roleLabel(assignment.role)}</span>
          <em className={`access-status access-status--${stale ? "stale" : assignment.status.toLowerCase()}`}><i />{stale ? "Not in roster" : titleCase(assignment.status)}</em>
          {/* A stale holder has no roster record to open, so the only sound
              action left is revoking the row. */}
          <button className="button button--quiet" disabled={!canManage} onClick={() => {
            if (stale || !member) setRevokeTarget({ tornUserId: assignment.tornUserId, name: assignment.memberName, inRoster: false });
            else inspect(member);
          }}>{!canManage ? "Restricted" : stale ? "Revoke" : "Manage"}</button>
        </article>;
      })}</div> : <div className="access-registry-empty"><span><KeyRound size={21} /></span><div><strong>{access.assignments.length ? "No assignments match" : "No roles assigned yet"}</strong><p>{access.assignments.length ? "Change the search or status filter to review other assignments." : `${access.message} Select a verified roster member from the directory to grant least-privilege access.`}</p></div></div>}
      {!canManage && <footer className="access-owner-note"><LockKeyhole size={14} /> Role changes are restricted to the verified platform owner in this release.</footer>}
    </section>}

    {accessView === "roles" && <section className="panel access-policy-panel">
      <div className="section-heading"><div><h2>Role policy</h2><p>Permission bundles enforced by Chainward</p></div><span className="analytics-panel-icon"><ShieldCheck size={17} /></span></div>
      <div className="role-policy-list">{roleOptions.map((definition) => {
        const assigned = access.assignments.filter((assignment) => assignment.role === definition.role).length;
        return <article key={definition.role} className={assigned > 0 ? "role-policy-card role-policy-card--assigned" : "role-policy-card"}>
          <span className="role-policy-card__icon"><UserCog size={17} /></span>
          <div className="role-policy-card__body">
            <div className="role-policy-card__heading"><strong>{definition.label}</strong><p>{definition.description}</p></div>
            <ul className="role-policy-card__permissions">{definition.permissions.map((descriptor) => <li key={descriptor.permission} title={descriptor.detail}><Check size={11} />{descriptor.label}</li>)}</ul>
          </div>
          <b className="role-policy-card__count" title={`${assigned} member${assigned === 1 ? "" : "s"} assigned`}>{assigned}<small>assigned</small></b>
        </article>;
      })}</div>
      <footer className="role-policy-footer">
        <p><ShieldCheck size={14} /><span><strong>Owner authority is intrinsic.</strong> It follows the verified platform identity and cannot be assigned, suspended, or revoked here. Restoring a backup and replacing the Torn credential stay with the owner.</span></p>
        <p><UserRoundX size={14} /><span><strong>Membership is re-checked on use.</strong> Every permission check confirms the holder is still on the verified Torn roster, so leaving the faction ends workspace access immediately.</span></p>
      </footer>
    </section>}

    {accessView === "directory" && <section className="data-section access-roster-section">
      <div className="section-heading access-roster-heading"><div><h2>Roster and access control</h2><p>{filtered.length} of {roster.length} verified members match this view</p></div><div className="table-tools"><label className="search-field"><Search size={15} /><span className="sr-only">Search faction roster</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Member, position, or Torn ID" /></label><label className="access-position-filter"><SlidersHorizontal size={14} /><span className="sr-only">Faction position</span><select value={position} onChange={(event) => { setPosition(event.target.value); setPage(0); }}>{positions.map((value) => <option key={value}>{value}</option>)}</select></label></div></div>
      <div className="roster-view-tabs" role="tablist" aria-label="Roster view">{([ ["all", "All members", roster.length], ["recent", "Active 15m", summary.active15Minutes], ["attention", "Needs attention", Math.max(0, roster.length - summary.okay)], ["assigned", "Access assigned", access.assignments.length] ] as const).map(([value, label, count]) => <button role="tab" aria-selected={view === value} className={view === value ? "roster-view-tab--active" : undefined} key={value} onClick={() => changeView(value)}>{label}<span>{count}</span></button>)}</div>
      {canManage && selectedIds.size > 0 && <div className="access-bulk-bar">
        <span><Check size={14} /><strong>{selectedIds.size} selected</strong><button onClick={() => setSelectedIds(new Set())}>Clear</button></span>
        <label><span>Role</span><select value={bulkRole} onChange={(event) => setBulkRole(event.target.value as ManagedFactionRole)}>{roleOptions.map((definition) => <option key={definition.role} value={definition.role}>{definition.label}</option>)}</select></label>
        <label><span>Status</span><select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as ManagedAccessStatus)}><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select></label>
        <small className="access-bulk-impact">{bulkChangedIds.length ? `${bulkChangedIds.length} will change${bulkChangedIds.length < selectedIds.size ? ` · ${selectedIds.size - bulkChangedIds.length} already match` : ""}` : "No changes needed"}</small>
        <button className="button button--primary" disabled={bulkWorking || !access.databaseAvailable || bulkChangedIds.length === 0} onClick={() => void saveBulkAccess()}>{bulkWorking && <Spinner size={14} label="Updating selected members" />}{bulkWorking ? "Updating…" : "Apply changes"}</button>
      </div>}
      <div className="table-scroll"><table className="data-table access-roster-table"><thead><tr>{canManage && <th className="access-selection-cell"><input type="checkbox" checked={allVisibleSelected} onChange={(event) => toggleVisible(event.target.checked)} aria-label="Select visible members" /></th>}<RosterSort label="Player" value="name" active={sortKey} onChange={setSortKey} /><th>Faction position</th><RosterSort label="Level" value="level" active={sortKey} onChange={setSortKey} numeric /><RosterSort label="Tenure" value="tenure" active={sortKey} onChange={setSortKey} numeric /><RosterSort label="Last action" value="activity" active={sortKey} onChange={setSortKey} /><th>Torn status</th><RosterSort label="App access" value="access" active={sortKey} onChange={setSortKey} /><th><span className="sr-only">Manage</span></th></tr></thead><tbody>{visible.map((member) => { const assignment = assignmentById.get(member.tornId); return <tr key={member.tornId}>{canManage && <td className="access-selection-cell"><input type="checkbox" checked={selectedIds.has(member.tornId)} onChange={(event) => toggleSelected(member.tornId, event.target.checked)} aria-label={`Select ${member.name}`} /></td>}<td><TornUserLink className="member-cell" name={member.name} tornUserId={member.tornId} detail={`Level ${member.level}`} /></td><td>{member.position || <span className="muted-value">Not returned</span>}</td><td className="numeric"><strong>{member.level}</strong></td><td className="numeric"><strong>{member.daysInFaction.toLocaleString()}</strong><small className="cell-subtext">days</small></td><td><strong>{member.lastAction}</strong></td><td><span className={`member-status member-status--${memberStatusClass(member.status)}`} title={member.statusDescription}><i />{member.status}</span></td><td>{assignment ? <span className="roster-access-cell"><strong>{roleLabel(assignment.role)}</strong><small className={`access-copy--${assignment.status.toLowerCase()}`}>{titleCase(assignment.status)}</small></span> : <span className="roster-access-none"><ShieldOff size={13} />None</span>}</td><td><button className="row-manage-button" onClick={() => inspect(member)}>{canManage ? assignment ? "Manage" : "Grant access" : "Inspect"}</button></td></tr>; })}</tbody></table>{visible.length === 0 && <div className="table-empty">No faction members match the selected search and filters.</div>}</div>
      <div className="table-footer"><span>Page {safePage + 1} of {pageCount} · sorted by {sortLabel(sortKey)}</span><div className="pagination"><button disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button><button disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button></div></div>
    </section>}

    {accessView === "audit" && <section className="panel access-audit-panel">
      <div className="section-heading"><div><h2>Access audit trail</h2><p>Latest persisted role and status changes</p></div><span className="analytics-panel-icon"><Clock3 size={17} /></span></div>
      {access.audit.length ? <div className="faction-access-audit-list">{access.audit.map((event) => { const actor = roster.find((member) => member.tornId === event.actorTornUserId); return <article key={event.id}><span>{auditIcon(event.action)}</span><div><strong>{event.memberName}</strong><p>{auditSentence(event.action, event.role)}</p></div>{event.actorTornUserId ? <TornUserName name={actor?.name ?? "Unknown user"} tornUserId={event.actorTornUserId} detail="Updated by" /> : <em>System actor</em>}<time dateTime={event.createdAt}>{formatAuditTime(event.createdAt)}</time></article>; })}</div> : <div className="access-audit-empty"><ShieldCheck size={17} /><span><strong>No access changes recorded</strong><small>The first role assignment will create an immutable audit entry here.</small></span></div>}
    </section>}

    <Dialog open={Boolean(selected)} className="dialog--member-access" title={selected ? `${selected.name} · workspace access` : "Workspace access"} description={selected ? "Verified member of the connected Torn faction" : undefined} confirmLabel={!canManage ? "Close" : accessImpact?.changed ? selectedAssignment ? "Save access" : "Grant access" : "No changes"} cancelLabel="Cancel" hideCancel={!canManage} confirmDisabled={canManage && (!access.databaseAvailable || !faction || !accessImpact?.changed)} onConfirm={canManage ? saveAccess : async () => undefined} onClose={() => setSelected(null)}>
      {selected && <div className="member-access-editor">
        <div className="member-access-profile"><MemberAvatar name={selected.name} /><div><strong>{selected.name}</strong><p>{selected.position || "Faction position unavailable"} · Level {selected.level}</p><span className={`member-status member-status--${memberStatusClass(selected.status)}`}><i />{selected.status}</span></div><button onClick={() => void copyTornId(selected.tornId)}><Copy size={13} />Copy ID</button></div>
        <dl className="member-access-facts"><div><dt>Last activity</dt><dd>{selected.lastAction}</dd></div><div><dt>Faction tenure</dt><dd>{selected.daysInFaction.toLocaleString()} days</dd></div><div><dt>Status detail</dt><dd>{selected.statusDescription || "No description returned"}</dd></div></dl>
        {canManage && <>
          <div className="access-editor-fields"><label><span>Application role</span><select value={draftRole} onChange={(event) => setDraftRole(event.target.value as ManagedFactionRole)}>{roleOptions.map((definition) => <option key={definition.role} value={definition.role}>{definition.label}</option>)}</select><small>{roleOptions.find((definition) => definition.role === draftRole)?.description}</small></label><label><span>Access status</span><select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as ManagedAccessStatus)}><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select><small>Suspended access remains auditable but cannot be used.</small></label></div>
          {accessImpact && <section className={`access-change-preview access-change-preview--${accessImpact.tone}`} aria-live="polite">
            <span>{accessImpact.tone === "danger" || accessImpact.tone === "warning" ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}</span>
            <div><strong>{accessImpact.title}</strong><p>{accessImpact.detail}</p>
              {(accessImpact.gained.length > 0 || accessImpact.removed.length > 0) && <dl>
                {accessImpact.gained.length > 0 && <div><dt>Added</dt><dd>{accessImpact.gained.map((permission) => <em key={permission.permission}>+ {permission.label}</em>)}</dd></div>}
                {accessImpact.removed.length > 0 && <div><dt>Removed</dt><dd>{accessImpact.removed.map((permission) => <em key={permission.permission}>− {permission.label}</em>)}</dd></div>}
              </dl>}
              <small>The server rechecks owner authority, faction scope, and current roster membership before saving.</small>
            </div>
          </section>}
          {assignmentById.has(selected.tornId) && <button className="revoke-access-button" onClick={() => { setSelected(null); setRevokeTarget({ tornUserId: selected.tornId, name: selected.name, inRoster: true }); }}><CircleSlash2 size={14} />Revoke this member&apos;s application access</button>}
        </>}
      </div>}
    </Dialog>

    <Dialog open={Boolean(revokeTarget)} className="dialog--revoke-access" title="Revoke application access?" description={revokeTarget ? `${revokeTarget.name} will no longer have a Chainward faction role.` : undefined} confirmLabel="Revoke access" destructive onConfirm={revokeAccess} onClose={() => setRevokeTarget(null)}>
      <div className="revoke-access-warning"><CircleSlash2 size={18} /><p><strong>This is an application control only.</strong><span>It does not change the player&apos;s Torn faction membership or position. The action remains in the access audit trail.</span></p></div>
      {revokeTarget && !revokeTarget.inRoster && <div className="revoke-access-warning revoke-access-warning--stale"><UserRoundX size={18} /><p><strong>Already outside the verified roster.</strong><span>This assignment is refused at every permission check. Revoking it removes the row so the registry matches what Chainward enforces.</span></p></div>}
    </Dialog>
  </div>;
}

function AccessStat({ icon: Icon, label, value, detail }: { icon: typeof UsersRound; label: string; value: string; detail: string }) { return <article><span><Icon size={17} /></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>; }
function AccessViewButton({ icon: Icon, label, description, count, active, onClick }: { icon: typeof UsersRound; label: string; description: string; count: number; active: boolean; onClick: () => void }) { return <button className={active ? "access-workspace-nav__active" : undefined} onClick={onClick} aria-current={active ? "page" : undefined}><span><Icon size={17} /></span><p><strong>{label}</strong><small>{description}</small></p><em>{count}</em></button>; }
function RosterSort({ label, value, active, onChange, numeric = false }: { label: string; value: SortKey; active: SortKey; onChange: (value: SortKey) => void; numeric?: boolean }) { return <th className={numeric ? "numeric" : undefined}><button className="sort-button" onClick={() => onChange(value)}>{label}<ChevronsUpDown size={13} className={active === value ? "sort-button__active" : undefined} /></button></th>; }

function compareMembers(left: TornRosterMember, right: TornRosterMember, sort: SortKey, assignments: Map<number, FactionAccessAssignment>): number {
  if (sort === "name") return left.name.localeCompare(right.name);
  if (sort === "level") return right.level - left.level;
  if (sort === "tenure") return right.daysInFaction - left.daysInFaction;
  if (sort === "access") return (assignments.get(left.tornId)?.role ?? "ZZZ").localeCompare(assignments.get(right.tornId)?.role ?? "ZZZ") || left.name.localeCompare(right.name);
  return right.lastActionAt - left.lastActionAt;
}

function titleCase(value: string): string { return value.charAt(0) + value.slice(1).toLowerCase(); }
function sortLabel(value: SortKey): string { return value === "activity" ? "recent activity" : value === "tenure" ? "faction tenure" : value; }
function memberStatusClass(status: string): string { const value = status.toLowerCase(); if (value.includes("okay")) return "online"; if (value.includes("hospital")) return "hospital"; if (value.includes("travel")) return "idle"; return "offline"; }
function auditIcon(action: string): string { return action === "GRANTED" ? "+" : action === "REVOKED" ? "−" : action === "SUSPENDED" ? "!" : "↻"; }
function auditSentence(action: string, role: ManagedFactionRole): string { return action === "GRANTED" ? `${roleLabel(role)} access granted` : action === "REVOKED" ? `${roleLabel(role)} access revoked` : action === "SUSPENDED" ? `${roleLabel(role)} access suspended` : `Role updated to ${roleLabel(role)}`; }
function formatCheckedAt(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unavailable" : `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date)} TCT`; }
function formatAuditTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
