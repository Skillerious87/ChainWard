"use client";

import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { TornUserLink } from "@/components/ui/torn-user-link";
import type { TornContribution } from "@/lib/torn/workspace-types";

type SortKey = "rank" | "name" | "hits" | "contribution" | "respect";
type SortDirection = "asc" | "desc";

interface ContributionTableProps {
  members: TornContribution[];
  title?: string;
  compact?: boolean;
  emptyMessage?: string;
  rewards?: Record<number, { amount: number; tierLabel: string | null }>;
  rewardUnit?: string | null;
  payoutStatus?: "READY" | "PAID" | null;
}

export function ContributionTable({ members, title = "Chain contribution", compact = false, emptyMessage = "Torn has not returned contribution records for this chain.", rewards, rewardUnit, payoutStatus = null }: ContributionTableProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("All");
  const [expanded, setExpanded] = useState(false);
  const statuses = useMemo(() => ["All", ...new Set(members.map((member) => member.status).filter((status): status is string => Boolean(status)))], [members]);

  const visibleMembers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return members
      .filter((member) => (!normalized || member.name.toLowerCase().includes(normalized) || String(member.tornId).includes(normalized)) && (statusFilter === "All" || member.status === statusFilter))
      .toSorted((left, right) => {
        const leftValue = left[sortKey];
        const rightValue = right[sortKey];
        const direction = sortDirection === "asc" ? 1 : -1;
        return typeof leftValue === "string" && typeof rightValue === "string"
          ? leftValue.localeCompare(rightValue) * direction
          : (Number(leftValue) - Number(rightValue)) * direction;
      });
  }, [members, query, sortDirection, sortKey, statusFilter]);
  const renderedMembers = compact && !expanded ? visibleMembers.slice(0, 6) : visibleMembers;

  function changeSort(nextKey: SortKey): void {
    if (nextKey === sortKey) {
      setSortDirection((value) => value === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "name" ? "asc" : "desc");
  }

  return (
    <section className="data-section">
      <div className="section-heading section-heading--table">
        <div><h2>{title}</h2><p>{members.length} contributors returned by Torn’s chain report</p></div>
        <div className="table-tools">
          <label className="search-field"><Search size={15} /><span className="sr-only">Search members</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search member or ID" /></label>
          <div className="menu-control">
            <button className={`button button--quiet${statusFilter !== "All" ? " button--active" : ""}`} onClick={() => setFilterOpen((value) => !value)} aria-expanded={filterOpen}><SlidersHorizontal size={15} /> Filter{statusFilter !== "All" ? " · On" : ""}</button>
            {filterOpen && <><button className="menu-control__scrim" aria-label="Close filters" onClick={() => setFilterOpen(false)} /><div className="filter-popover"><div><strong>Torn status</strong><small>Filter the joined faction roster</small></div>{statuses.map((status) => <button key={status} onClick={() => { setStatusFilter(status); setFilterOpen(false); }}><span>{status}</span>{statusFilter === status && <Check size={13} />}</button>)}</div></>}
          </div>
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table contribution-table">
          <thead><tr><SortableHeader label="Rank" sortKey="rank" activeKey={sortKey} direction={sortDirection} onSort={changeSort} /><SortableHeader label="Player" sortKey="name" activeKey={sortKey} direction={sortDirection} onSort={changeSort} /><SortableHeader label="Chain hits" sortKey="hits" activeKey={sortKey} direction={sortDirection} onSort={changeSort} align="right" />{!compact && <SortableHeader label="Contribution" sortKey="contribution" activeKey={sortKey} direction={sortDirection} onSort={changeSort} align="right" />}<SortableHeader label="Respect" sortKey="respect" activeKey={sortKey} direction={sortDirection} onSort={changeSort} align="right" />{rewards && <th className="numeric">Member reward</th>}{!compact && <th>Torn status</th>}</tr></thead>
          <tbody>{renderedMembers.map((member) => <tr key={member.tornId}>
            <td data-label="Rank"><span className={`rank${member.rank <= 3 ? " rank--top" : ""}`}>{member.rank}</span></td>
            <td data-label="Player"><TornUserLink className="member-cell" name={member.name} tornUserId={member.tornId} detail="View Torn profile" /></td>
            <td className="numeric" data-label="Chain hits"><strong>{member.hits.toLocaleString()}</strong></td>
            {!compact && <td className="numeric" data-label="Contribution"><span className="contribution-value">{member.contribution.toFixed(1)}%</span><span className="mini-progress"><i style={{ width: `${Math.min(member.contribution, 100)}%` }} /></span></td>}
            <td className="numeric" data-label="Respect"><strong>{member.respect.toFixed(2)}</strong></td>
            {rewards && <td className="numeric" data-label="Member reward"><span className={payoutStatus === "PAID" ? "member-reward member-reward--paid" : "member-reward"}><strong>{(rewards[member.tornId]?.amount ?? 0).toLocaleString()}</strong><small>{rewardUnit ?? "units"} · {rewards[member.tornId]?.tierLabel ?? "No tier"}</small>{payoutStatus === "PAID" && <Check size={11} />}</span></td>}
            {!compact && <td data-label="Torn status">{member.status ? <span className={`member-status member-status--${statusClass(member.status)}`}><i />{member.status}</span> : <span className="muted-value">Unavailable</span>}</td>}
          </tr>)}</tbody>
        </table>
        {visibleMembers.length === 0 && <div className="table-empty">{query ? `No members match “${query}”.` : emptyMessage}</div>}
      </div>
      <div className="table-footer"><span>Showing {renderedMembers.length} of {visibleMembers.length} verified contributors</span>{compact && visibleMembers.length > 6 && <button onClick={() => setExpanded((value) => !value)}>{expanded ? "Show leading contributors" : "View all contributors"} →</button>}</div>
    </section>
  );
}

interface SortableHeaderProps { label: string; sortKey: SortKey; activeKey: SortKey; direction: SortDirection; onSort: (key: SortKey) => void; align?: "left" | "right"; }

function SortableHeader({ label, sortKey, activeKey, direction, onSort, align = "left" }: SortableHeaderProps) {
  const active = activeKey === sortKey;
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return <th className={align === "right" ? "numeric" : undefined}><button className="sort-button" onClick={() => onSort(sortKey)}>{label}<Icon size={13} className={active ? "sort-button__active" : ""} /></button></th>;
}

function statusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("hospital")) return "hospital";
  if (normalized.includes("okay") || normalized.includes("online")) return "online";
  if (normalized.includes("travel")) return "idle";
  return "offline";
}
