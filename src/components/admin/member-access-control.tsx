"use client";

import {
  BadgeCheck,
  CircleSlash2,
  Clock3,
  LockKeyhole,
  Search,
  ShieldCheck,
  UserCog,
  UserRoundX,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { revokeAdminMemberAccess, updateAdminMemberAccess } from "@/app/(platform)/admin/actions";
import { Dialog } from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { TornUserName } from "@/components/ui/torn-user-link";
import { roleDefinitions, roleLabel } from "@/lib/auth/authorization";
import type {
  FactionAccessAssignment,
  FactionAccessRequest,
  FactionAccessWorkspace,
  ManagedAccessStatus,
  ManagedFactionRole,
} from "@/lib/auth/faction-access-store";
import { notify } from "@/lib/client-actions";
import type { TornDataResult, TornRosterMember } from "@/lib/torn/workspace-types";

type AccessFilter = "pending" | "active" | "suspended" | "all";

interface FactionSummary {
  id: number;
  name: string;
  tag: string;
}

interface PersonRow {
  key: string;
  tornUserId: number;
  memberName: string;
  request: FactionAccessRequest | null;
  assignment: FactionAccessAssignment | null;
  rosterMember: TornRosterMember | null;
  stale: boolean;
}

export function MemberAccessControl({
  access,
  rosterResult,
  faction,
}: {
  access: FactionAccessWorkspace;
  rosterResult: TornDataResult<TornRosterMember[]>;
  faction: FactionSummary | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<AccessFilter>(access.requests.length ? "pending" : "all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PersonRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<PersonRow | null>(null);
  const [draftRole, setDraftRole] = useState<ManagedFactionRole>("VIEWER");
  const [draftStatus, setDraftStatus] = useState<ManagedAccessStatus>("ACTIVE");

  const rosterById = useMemo(
    () => new Map(rosterResult.data.map((member) => [member.tornId, member])),
    [rosterResult.data],
  );
  const rows = useMemo<PersonRow[]>(() => {
    const requests = access.requests.map((request) => ({
      key: `request-${request.tornUserId}`,
      tornUserId: request.tornUserId,
      memberName: request.memberName,
      request,
      assignment: null,
      rosterMember: rosterById.get(request.tornUserId) ?? null,
      stale: rosterResult.available && !rosterById.has(request.tornUserId),
    }));
    const assignments = access.assignments.map((assignment) => ({
      key: `assignment-${assignment.tornUserId}`,
      tornUserId: assignment.tornUserId,
      memberName: assignment.memberName,
      request: null,
      assignment,
      rosterMember: rosterById.get(assignment.tornUserId) ?? null,
      stale: rosterResult.available && !rosterById.has(assignment.tornUserId),
    }));
    return [...requests, ...assignments];
  }, [access.assignments, access.requests, rosterById, rosterResult.available]);

  const counts = {
    pending: access.requests.length,
    active: access.assignments.filter((item) => item.status === "ACTIVE").length,
    suspended: access.assignments.filter((item) => item.status === "SUSPENDED").length,
    all: rows.length,
  };
  const staleCount = rows.filter((row) => row.stale).length;
  const visibleRows = rows.filter((row) => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery = !normalized
      || row.memberName.toLowerCase().includes(normalized)
      || String(row.tornUserId).includes(normalized)
      || (row.assignment ? roleLabel(row.assignment.role).toLowerCase().includes(normalized) : false);
    const matchesFilter = filter === "all"
      || (filter === "pending" && Boolean(row.request))
      || (filter === "active" && row.assignment?.status === "ACTIVE")
      || (filter === "suspended" && row.assignment?.status === "SUSPENDED");
    return matchesQuery && matchesFilter;
  });

  function inspect(row: PersonRow) {
    setDraftRole(row.assignment?.role ?? "VIEWER");
    setDraftStatus(row.assignment?.status ?? "ACTIVE");
    setSelected(row);
  }

  async function saveAccess() {
    if (!selected || !faction) return;
    const result = await updateAdminMemberAccess({
      factionId: faction.id,
      tornUserId: selected.tornUserId,
      role: draftRole,
      status: selected.request ? "ACTIVE" : draftStatus,
    });
    notify({ title: result.ok ? "Access updated" : "Access was not changed", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
    router.refresh();
  }

  async function revokeAccess() {
    if (!revokeTarget || !faction) return;
    const result = await revokeAdminMemberAccess({ factionId: faction.id, tornUserId: revokeTarget.tornUserId });
    notify({ title: result.ok ? "Access revoked" : "Access was not changed", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
    router.refresh();
  }

  const unchanged = Boolean(selected?.assignment
    && selected.assignment.role === draftRole
    && selected.assignment.status === draftStatus);
  const selectedCanSave = Boolean(
    selected
    && faction
    && access.databaseAvailable
    && rosterResult.available
    && selected.rosterMember
    && !selected.stale
    && !unchanged,
  );

  return (
    <section className="admin-member-control" id="member-access" aria-labelledby="member-access-title">
      <header className="admin-member-control__header">
        <span className="admin-member-control__mark"><UsersRound size={22} /></span>
        <div>
          <p className="eyebrow">People &amp; permissions</p>
          <h2 id="member-access-title">Member access control</h2>
          <p>Review verified sign-ins, assign the minimum role needed, suspend access, or revoke it immediately.</p>
        </div>
        <span className="admin-owner-lock"><LockKeyhole size={14} /> Owner only</span>
      </header>

      <div className="admin-access-summary" aria-label="Access status summary">
        <SummaryItem icon={<Clock3 size={17} />} label="Awaiting review" value={counts.pending} tone={counts.pending ? "warning" : "muted"} />
        <SummaryItem icon={<BadgeCheck size={17} />} label="Active access" value={counts.active} tone="success" />
        <SummaryItem icon={<CircleSlash2 size={17} />} label="Suspended" value={counts.suspended} tone={counts.suspended ? "danger" : "muted"} />
        <SummaryItem icon={<UserRoundX size={17} />} label="Roster mismatch" value={staleCount} tone={staleCount ? "warning" : "muted"} />
      </div>

      <div className="admin-member-toolbar">
        <div className="admin-access-tabs" role="tablist" aria-label="Filter member access">
          {(["pending", "active", "suspended", "all"] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}>
              {filterLabel(value)} <span>{counts[value]}</span>
            </button>
          ))}
        </div>
        <label className="search-field admin-member-search">
          <Search size={15} />
          <span className="sr-only">Search people</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ID or role" />
        </label>
      </div>

      {!access.databaseAvailable && (
        <div className="admin-access-alert admin-access-alert--danger"><CircleSlash2 size={17} /><p><strong>Access registry unavailable</strong><span>{access.message}</span></p></div>
      )}
      {!rosterResult.available && (
        <div className="admin-access-alert"><Clock3 size={17} /><p><strong>Roster verification unavailable</strong><span>Changes are disabled until Torn can confirm current faction membership.</span></p></div>
      )}

      <div className="admin-people-list" role="list" aria-label="Member access records">
        {visibleRows.map((row) => (
          <article className={`admin-person-row${row.request ? " admin-person-row--pending" : ""}${row.stale ? " admin-person-row--stale" : ""}`} key={row.key} role="listitem">
            <MemberAvatar name={row.memberName} />
            <div className="admin-person-row__identity">
              <TornUserName name={row.memberName} tornUserId={row.tornUserId} detail={`Torn ID ${row.tornUserId}`} />
              <small>{row.rosterMember?.position || (row.stale ? "No longer in current roster" : "Faction member")}</small>
            </div>
            <div className="admin-person-row__role">
              <small>Role</small>
              <strong>{row.assignment ? roleLabel(row.assignment.role) : "Not assigned"}</strong>
            </div>
            <span className={`admin-access-state admin-access-state--${row.request ? "pending" : row.stale ? "stale" : row.assignment?.status.toLowerCase()}`}>
              <i />{row.request ? "Awaiting review" : row.stale ? "Roster mismatch" : titleCase(row.assignment?.status ?? "")}
            </span>
            <div className="admin-person-row__activity">
              <small>{row.request ? "Requested" : "Last changed"}</small>
              <time dateTime={row.request?.requestedAt ?? row.assignment?.updatedAt}>{formatDate(row.request?.requestedAt ?? row.assignment?.updatedAt)}</time>
            </div>
            <button className="button button--secondary admin-person-row__action" type="button" onClick={() => inspect(row)}>
              <UserCog size={15} /> {row.request ? "Review" : "Manage"}
            </button>
          </article>
        ))}
        {visibleRows.length === 0 && (
          <div className="admin-people-empty">
            <ShieldCheck size={24} />
            <strong>{rows.length ? "No records match this view" : "No member access records yet"}</strong>
            <p>{rows.length ? "Try another filter or clear the search." : "Verified sign-in requests will appear here automatically."}</p>
          </div>
        )}
      </div>

      <footer className="admin-member-control__footer">
        <LockKeyhole size={14} />
        <span>Every change is re-authorized server-side against <strong>Skillerious · Torn ID 3212954</strong>, the connected faction, active licence, and current roster.</span>
      </footer>

      <Dialog
        open={Boolean(selected)}
        className="dialog--admin-member-access"
        title={selected ? `${selected.memberName} · access` : "Member access"}
        description={selected?.request ? "Review a verified Chainward sign-in request" : "Change this member's application permissions"}
        confirmLabel={selected?.request ? "Approve access" : unchanged ? "No changes" : "Save changes"}
        confirmDisabled={!selectedCanSave}
        onConfirm={saveAccess}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="admin-access-form">
            <div className="admin-access-form__person">
              <MemberAvatar name={selected.memberName} />
              <TornUserName name={selected.memberName} tornUserId={selected.tornUserId} detail={selected.rosterMember?.position ?? `Torn ID ${selected.tornUserId}`} />
              <span className={`admin-access-state admin-access-state--${selected.request ? "pending" : selected.stale ? "stale" : selected.assignment?.status.toLowerCase()}`}>
                <i />{selected.request ? "Verified request" : selected.stale ? "Roster mismatch" : titleCase(selected.assignment?.status ?? "")}
              </span>
            </div>

            {selected.request && (
              <div className="admin-access-alert"><Clock3 size={17} /><p><strong>Approval requested {formatDate(selected.request.requestedAt)}</strong><span>Start with the least-privilege role this person needs.</span></p></div>
            )}
            {selected.stale && (
              <div className="admin-access-alert admin-access-alert--danger"><UserRoundX size={17} /><p><strong>Player is not in the current faction roster</strong><span>Permissions cannot be changed. Revoke this stale assignment below.</span></p></div>
            )}

            <fieldset className="admin-role-picker" disabled={selected.stale}>
              <legend>Application role</legend>
              {roleDefinitions.map((definition) => (
                <label key={definition.role} className={draftRole === definition.role ? "admin-role-option--selected" : undefined}>
                  <input type="radio" name="admin-role" checked={draftRole === definition.role} onChange={() => setDraftRole(definition.role)} />
                  <span><UserCog size={16} /></span>
                  <div><strong>{definition.label}</strong><small>{definition.description}</small></div>
                  <em>{definition.permissions.length} permission{definition.permissions.length === 1 ? "" : "s"}</em>
                </label>
              ))}
            </fieldset>

            {selected.assignment && !selected.stale && (
              <fieldset className="admin-status-picker">
                <legend>Access status</legend>
                <label className={draftStatus === "ACTIVE" ? "admin-status-option--active" : undefined}>
                  <input type="radio" name="admin-status" checked={draftStatus === "ACTIVE"} onChange={() => setDraftStatus("ACTIVE")} />
                  <BadgeCheck size={16} /><span><strong>Active</strong><small>Role permissions can be used now</small></span>
                </label>
                <label className={draftStatus === "SUSPENDED" ? "admin-status-option--suspended" : undefined}>
                  <input type="radio" name="admin-status" checked={draftStatus === "SUSPENDED"} onChange={() => setDraftStatus("SUSPENDED")} />
                  <CircleSlash2 size={16} /><span><strong>Suspended</strong><small>Retain the record but block all access</small></span>
                </label>
              </fieldset>
            )}

            {selected.assignment && (
              <button className="admin-revoke-control" type="button" onClick={() => { setSelected(null); setRevokeTarget(selected); }}>
                <UserRoundX size={16} /><span><strong>Revoke application access</strong><small>Remove this role assignment completely</small></span>
              </button>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(revokeTarget)}
        className="dialog--revoke-access"
        title="Revoke application access?"
        description={revokeTarget ? `${revokeTarget.memberName} will immediately lose their Chainward faction role.` : undefined}
        confirmLabel="Revoke access"
        destructive
        onConfirm={revokeAccess}
        onClose={() => setRevokeTarget(null)}
      >
        <div className="admin-access-alert admin-access-alert--danger"><UserRoundX size={17} /><p><strong>This takes effect immediately</strong><span>The player can submit a new verified access request later.</span></p></div>
      </Dialog>
    </section>
  );
}

function SummaryItem({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "success" | "warning" | "danger" | "muted" }) {
  return <div className={`admin-access-summary__item admin-access-summary__item--${tone}`}><span>{icon}</span><p><strong>{value}</strong><small>{label}</small></p></div>;
}

function filterLabel(value: AccessFilter): string {
  if (value === "pending") return "Awaiting";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function titleCase(value: string): string {
  return value ? value[0] + value.slice(1).toLowerCase() : "Unknown";
}

function formatDate(value?: string): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}
