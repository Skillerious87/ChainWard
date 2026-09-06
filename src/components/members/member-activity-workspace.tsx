"use client";

import {
  Activity,
  AlarmClock,
  BellRing,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock3,
  Eye,
  FileUser,
  ListFilter,
  RefreshCw,
  Repeat2,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Umbrella,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { updateMemberActivity, updateMemberActivityPolicy } from "@/app/(platform)/members/actions";
import { useWorkspaceSectionNavigation } from "@/components/shell/workspace-section-navigation";
import { ExportButton } from "@/components/ui/action-controls";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { TornUserLink, TornUserName } from "@/components/ui/torn-user-link";
import { notify } from "@/lib/client-actions";
import { assessMemberActivity, criticalThreshold, type MemberActivityAssessment } from "@/lib/members/member-activity-intelligence";
import type {
  ManagedMemberActivityState,
  MemberActivityAuditEvent,
  MemberActivityInputState,
  MemberActivityWorkspace as ActivityWorkspace,
} from "@/lib/members/member-activity-store";
import { buildMemberInactivityInsights, periodDurationSeconds, type MemberInactivityPeriod } from "@/lib/members/member-inactivity";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";
import type { TornDataResult, TornRosterMember } from "@/lib/torn/workspace-types";

type WorkspaceView = "overview" | "roster" | "patterns" | "controls";
type ActivityView = "all" | "attention" | "critical" | "dueSoon" | "active" | "holiday" | "expired" | "watch";
type ActivitySort = "attention" | "recent" | "inactive" | "name" | "level" | "tenure";
type ManagedFilter = "all" | "standard" | "holiday" | "expired" | "watch";
type HistoryView = "members" | "periods";

const ROSTER_PAGE_SIZE = 10;
const HISTORY_PAGE_SIZE = 10;
const AUDIT_PAGE_SIZE = 6;

interface MemberActivityWorkspaceProps {
  rosterResult: TornDataResult<TornRosterMember[]>;
  telemetry: WorkspaceTelemetry;
  activity: ActivityWorkspace;
  canManage: boolean;
}

export function MemberActivityWorkspace({ rosterResult, telemetry, activity, canManage }: MemberActivityWorkspaceProps) {
  const router = useRouter();
  const { view: workspaceViewValue, selectView: selectWorkspaceSection } = useWorkspaceSectionNavigation("members");
  const workspaceView = isWorkspaceView(workspaceViewValue) ? workspaceViewValue : "overview";
  const members = rosterResult.data;
  const faction = telemetry.faction;
  const parsedCheckedAt = Date.parse(rosterResult.checkedAt);
  const checkedAt = Math.floor((Number.isNaN(parsedCheckedAt) ? Date.now() : parsedCheckedAt) / 1_000);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ActivityView>("all");
  const [position, setPosition] = useState("All positions");
  const [tornStatus, setTornStatus] = useState("All statuses");
  const [managedFilter, setManagedFilter] = useState<ManagedFilter>("all");
  const [thresholdDays, setThresholdDays] = useState(activity.policy.thresholdDays);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [sort, setSort] = useState<ActivitySort>("attention");
  const [rosterPage, setRosterPage] = useState(1);
  const [selected, setSelected] = useState<TornRosterMember | null>(null);
  const [draftState, setDraftState] = useState<MemberActivityInputState>("STANDARD");
  const [holidayUntil, setHolidayUntil] = useState("");
  const [note, setNote] = useState("");
  const [refreshing, startRefresh] = useTransition();

  const recordById = useMemo(() => new Map(activity.records.map((record) => [record.tornUserId, record])), [activity.records]);
  const positions = useMemo(() => ["All positions", ...[...new Set(members.map((member) => member.position || "Unassigned"))].toSorted()], [members]);
  const statuses = useMemo(() => ["All statuses", ...[...new Set(members.map((member) => member.status || "Unknown"))].toSorted()], [members]);
  const rows = useMemo(() => members.map((member) => assessMemberActivity(member, recordById.get(member.tornId), checkedAt, thresholdDays)), [checkedAt, members, recordById, thresholdDays]);
  const summary = useMemo(() => ({
    activeDay: rows.filter((row) => row.ageSeconds <= 86_400).length,
    attention: rows.filter((row) => row.needsAttention).length,
    critical: rows.filter((row) => row.critical).length,
    dueSoon: rows.filter((row) => row.band === "Due soon").length,
    holiday: rows.filter((row) => row.holidayActive).length,
    expired: rows.filter((row) => row.holidayExpired).length,
    watch: rows.filter((row) => row.record?.state === "WATCH").length,
  }), [rows]);
  const priorityQueue = useMemo(() => rows
    .filter((row) => row.needsAttention || row.band === "Due soon")
    .toSorted((left, right) => compareRows(left, right, "attention"))
    .slice(0, 4), [rows]);
  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !normalized || `${row.member.name} ${row.member.tornId} ${row.member.position} ${row.member.lastAction} ${row.member.status} ${row.band} ${row.reason} ${row.record?.note ?? ""}`.toLowerCase().includes(normalized);
      const matchesPosition = position === "All positions" || (row.member.position || "Unassigned") === position;
      const matchesStatus = tornStatus === "All statuses" || (row.member.status || "Unknown") === tornStatus;
      const matchesManagedState = managedFilter === "all"
        || (managedFilter === "standard" && !row.record)
        || (managedFilter === "holiday" && row.holidayActive)
        || (managedFilter === "expired" && row.holidayExpired)
        || (managedFilter === "watch" && row.record?.state === "WATCH");
      const matchesView = view === "all"
        || (view === "attention" && row.needsAttention)
        || (view === "critical" && row.critical)
        || (view === "dueSoon" && row.band === "Due soon")
        || (view === "active" && row.ageSeconds <= 86_400)
        || (view === "holiday" && row.holidayActive)
        || (view === "expired" && row.holidayExpired)
        || (view === "watch" && row.record?.state === "WATCH");
      return matchesQuery && matchesPosition && matchesStatus && matchesManagedState && matchesView;
    }).toSorted((left, right) => compareRows(left, right, sort));
  }, [managedFilter, position, query, rows, sort, tornStatus, view]);
  const rosterPages = Math.max(1, Math.ceil(filteredRows.length / ROSTER_PAGE_SIZE));
  const currentRosterPage = Math.min(rosterPage, rosterPages);
  const pagedRows = filteredRows.slice((currentRosterPage - 1) * ROSTER_PAGE_SIZE, currentRosterPage * ROSTER_PAGE_SIZE);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const requestedView = parameters.get("view");
    const timer = window.setTimeout(() => {
      if (isActivityView(requestedView)) {
        setView(requestedView);
        if (!parameters.get("section")) selectWorkspaceSection("roster");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectWorkspaceSection]);

  function selectWorkspaceView(next: WorkspaceView): void {
    selectWorkspaceSection(next);
    if (next !== "roster") {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("view");
      window.history.replaceState(null, "", nextUrl);
    }
  }

  function selectActivityView(next: ActivityView): void {
    setView(next);
    setRosterPage(1);
    selectWorkspaceSection("roster");
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("view", next);
    window.history.replaceState(null, "", nextUrl);
  }

  function inspect(member: TornRosterMember): void {
    const record = recordById.get(member.tornId);
    setDraftState(record?.state ?? "STANDARD");
    setHolidayUntil(record?.holidayUntil ? record.holidayUntil.slice(0, 10) : "");
    setNote(record?.note ?? "");
    setSelected(member);
  }

  async function save(): Promise<void> {
    if (!selected || !faction) return;
    let result: Awaited<ReturnType<typeof updateMemberActivity>>;
    try {
      result = await updateMemberActivity({ factionId: faction.id, tornUserId: selected.tornId, state: draftState, holidayUntil: draftState === "HOLIDAY" && holidayUntil ? new Date(`${holidayUntil}T23:59:59.999Z`).toISOString() : null, note });
    } catch {
      notify({ title: "Activity was not changed", description: "The activity update could not reach the server. The editor has been kept open so you can retry.", tone: "danger" });
      throw new Error("Member activity request failed.");
    }
    notify({ title: result.ok ? "Member activity updated" : "Activity was not changed", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
    router.refresh();
  }

  async function saveThreshold(): Promise<void> {
    const savedThreshold = activity.policy.thresholdDays;
    if (thresholdDays === savedThreshold) return;
    if (!canManage || !faction || !activity.databaseAvailable) {
      setThresholdDays(savedThreshold);
      return;
    }
    setSavingPolicy(true);
    try {
      const result = await updateMemberActivityPolicy({ factionId: faction.id, thresholdDays });
      notify({ title: result.ok ? "Owner alert policy saved" : "Alert policy was not changed", description: result.message, tone: result.ok ? "success" : "danger" });
      if (!result.ok) {
        setThresholdDays(savedThreshold);
        return;
      }
      router.refresh();
    } catch {
      setThresholdDays(savedThreshold);
      notify({ title: "Alert policy was not changed", description: "The policy save could not reach the server. Your previous threshold is still active.", tone: "danger" });
    } finally {
      setSavingPolicy(false);
    }
  }

  function resetFilters(): void {
    setQuery("");
    setPosition("All positions");
    setTornStatus("All statuses");
    setManagedFilter("all");
    setView("all");
    setRosterPage(1);
  }

  const exportRows = filteredRows.map((row) => ({ name: row.member.name, tornId: row.member.tornId, factionPosition: row.member.position, level: row.member.level, daysInFaction: row.member.daysInFaction, lastAction: row.member.lastAction, inactivityDays: Number(row.daysInactive.toFixed(2)), riskScore: row.riskScore, smartSignal: row.band, attentionReason: row.reason, tornStatus: row.member.status, managedState: row.record?.state ?? "STANDARD", holidayUntil: row.record?.holidayUntil ?? "", note: row.record?.note ?? "" }));
  const historyExportRows = activity.inactivityPeriods.map((period) => ({ memberName: period.memberName, tornUserId: period.tornUserId, startedAt: period.startedAt, qualifyingAt: period.qualifyingAt, endedAt: period.endedAt ?? "Ongoing", durationDays: Number((periodDurationSeconds(period, checkedAt) / 86_400).toFixed(2)), firstObservedAt: period.firstObservedAt, lastObservedAt: period.lastObservedAt, holidayProtected: period.holidayProtected ? "Yes" : "No", watchListed: period.watchListed ? "Yes" : "No" }));
  const criticalAfterDays = criticalThreshold(thresholdDays);
  const policyDirty = thresholdDays !== activity.policy.thresholdDays;
  const policyDisabled = !canManage || !activity.databaseAvailable || !faction || savingPolicy;
  const holidayEnd = holidayUntil ? Date.parse(`${holidayUntil}T23:59:59.999Z`) : null;
  const holidayDateInvalid = draftState === "HOLIDAY" && holidayEnd !== null && (Number.isNaN(holidayEnd) || holidayEnd <= Date.now());
  const filtersActive = Boolean(query || position !== "All positions" || tornStatus !== "All statuses" || managedFilter !== "all" || view !== "all");

  return <div className="page-stack member-activity-workspace">
    <PageHeader
      eyebrow="Faction readiness"
      title="Members"
      description="Review current risk, inspect the roster, find inactivity patterns, and manage policy from one focused workspace."
      actions={<>
        <button className="button button--secondary" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>
          {refreshing ? <Spinner size={15} label="Refreshing member activity" tone="muted" /> : <RefreshCw size={15} />}
          {refreshing ? "Refreshing…" : "Refresh roster"}
        </button>
        {workspaceView === "patterns" && <ExportButton filename="chainward-inactivity-periods.csv" label="Export periods" rows={historyExportRows} />}
        {workspaceView === "roster" && <ExportButton filename="chainward-member-activity.csv" label="Export roster" rows={exportRows} />}
      </>}
    />

    <section id="members-panel-overview" className="member-workspace-panel" role="tabpanel" aria-labelledby="members-tab-overview" hidden={workspaceView !== "overview"}>
      <section className={`member-activity-brief${summary.critical ? " member-activity-brief--critical" : summary.attention ? " member-activity-brief--attention" : ""}`}>
        <span><Activity size={22} /></span>
        <div role="status" aria-live="polite"><p className="eyebrow">Current posture</p><h2>{summary.critical ? `${summary.critical} critical member alert${summary.critical === 1 ? "" : "s"}.` : summary.attention ? `${summary.attention} member${summary.attention === 1 ? "" : "s"} need review.` : "The current roster is within policy."}</h2><p>Review begins after {thresholdDays} inactive day{thresholdDays === 1 ? "" : "s"}; critical escalation begins after {criticalAfterDays}. Holidays remain protected.</p></div>
        <div className="member-activity-brief__actions">{summary.attention > 0 && <button type="button" className="button button--primary" onClick={() => selectActivityView("attention")}>Review queue <ChevronRight size={14} /></button>}<button type="button" className="button button--secondary" onClick={() => selectWorkspaceView("patterns")}>View patterns</button></div>
      </section>

      <section className="member-activity-stats">
        <ActivityStat icon={UsersRound} label="Verified roster" value={rosterResult.available ? members.length : null} detail="Current Torn members" />
        <ActivityStat icon={UserRoundCheck} label="Active in 24h" value={rosterResult.available ? summary.activeDay : null} detail="Based on Torn last_action" />
        <ActivityStat icon={AlarmClock} label="Needs review" value={rosterResult.available ? summary.attention : null} detail={`After ${thresholdDays} inactive days`} tone={summary.attention ? "attention" : "ready"} />
        <ActivityStat icon={ShieldAlert} label="Critical alerts" value={rosterResult.available ? summary.critical : null} detail={`After ${criticalAfterDays} days`} tone={summary.critical ? "critical" : "ready"} />
        <ActivityStat icon={Umbrella} label="On holiday" value={activity.databaseAvailable ? summary.holiday : null} detail="Protected exemptions" />
        <ActivityStat icon={Eye} label="Watch list" value={activity.databaseAvailable ? summary.watch : null} detail="Manual follow-up" />
      </section>

      <section className="panel member-priority-queue">
        <div className="section-heading"><div><h2>Follow-up queue</h2><p>Highest-risk members and approaching thresholds</p></div><button type="button" className="member-section-link" onClick={() => selectActivityView("all")}>Full roster <ChevronRight size={13} /></button></div>
        {priorityQueue.length ? <div className="member-priority-queue__grid">{priorityQueue.map((row, index) => <article key={row.member.tornId} className={row.critical ? "member-priority-card--critical" : undefined}><header><span>#{index + 1}</span><em>Risk {row.riskScore}</em></header><TornUserLink name={row.member.name} tornUserId={row.member.tornId} detail={`${row.member.position || "Unassigned"} · ${formatAge(row.ageSeconds)}`} /><p>{row.reason}</p><footer><span className={`activity-band activity-band--${bandClass(row.band)}`}><i />{row.band}</span><div className="member-row-actions"><Link href={`/members/${row.member.tornId}`}><FileUser size={13} /> Report</Link><button onClick={() => inspect(row.member)}>{canManage ? "Manage" : "Inspect"}</button></div></footer></article>)}</div> : <div className="member-priority-queue__empty"><ShieldCheck size={18} /><div><strong>No follow-up queue</strong><p>No member is at or approaching the current inactivity threshold.</p></div></div>}
      </section>
    </section>

    <section id="members-panel-roster" className="member-workspace-panel" role="tabpanel" aria-labelledby="members-tab-roster" hidden={workspaceView !== "roster"}>
      <section className="data-section member-activity-table-section">
        <div className="section-heading member-activity-table-heading"><div><h2>Roster activity</h2><p>{filteredRows.length} of {members.length} verified members match this view</p><small className="member-table-scroll-hint">Scan member activity and status. Expand a row for more detail.</small></div><div className="table-tools"><label className="search-field"><Search size={15} /><span className="sr-only">Search member activity</span><input value={query} onChange={(event) => { setQuery(event.target.value); setRosterPage(1); }} placeholder="Search member, status, ID, or note" /></label><label className="member-activity-select"><SlidersHorizontal size={14} /><span className="sr-only">Faction position</span><select value={position} onChange={(event) => { setPosition(event.target.value); setRosterPage(1); }}>{positions.map((item) => <option key={item}>{item}</option>)}</select></label><label className="member-activity-select"><Activity size={14} /><span className="sr-only">Torn status</span><select value={tornStatus} onChange={(event) => { setTornStatus(event.target.value); setRosterPage(1); }}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label><label className="member-activity-select"><ShieldCheck size={14} /><span className="sr-only">Managed activity state</span><select value={managedFilter} onChange={(event) => { setManagedFilter(event.target.value as ManagedFilter); setRosterPage(1); }}><option value="all">All policy states</option><option value="standard">Standard policy</option><option value="holiday">Protected holiday</option><option value="expired">Expired holiday</option><option value="watch">Watch list</option></select></label>{filtersActive && <button type="button" className="member-filter-reset" onClick={resetFilters}><ListFilter size={13} /> Clear</button>}</div></div>
        <div className="member-activity-tabs" role="tablist" aria-label="Roster activity view">{([ ["all", "All", members.length], ["attention", "Review", summary.attention], ["critical", "Critical", summary.critical], ["dueSoon", "Due soon", summary.dueSoon], ["active", "Active 24h", summary.activeDay], ["holiday", "Holiday", summary.holiday], ["expired", "Expired", summary.expired], ["watch", "Watch", summary.watch] ] as const).map(([value, label, count]) => <button type="button" key={value} role="tab" aria-selected={view === value} className={view === value ? "member-activity-tab--active" : undefined} onClick={() => selectActivityView(value)}>{label}<span>{count}</span></button>)}</div>
        <div className="member-activity-sort"><span>Sort</span>{([ ["attention", "Priority"], ["recent", "Most recent"], ["inactive", "Longest inactive"], ["name", "Name"], ["level", "Level"], ["tenure", "Tenure"] ] as const).map(([value, label]) => <button type="button" aria-pressed={sort === value} className={sort === value ? "member-activity-sort--active" : undefined} key={value} onClick={() => { setSort(value); setRosterPage(1); }}>{label}{sort === value && <ChevronsUpDown size={12} />}</button>)}</div>
        <ul className="member-roster-list" aria-label="Roster activity list">{pagedRows.map((row) => <MemberRosterListRow key={row.member.tornId} row={row} canManage={canManage} onInspect={() => inspect(row.member)} />)}{filteredRows.length === 0 && <li className="table-empty">No matching members. Adjust the search or activity filters.</li>}</ul>
        <div className="table-scroll member-roster-table-scroll" role="region" aria-label="Roster activity table" tabIndex={0}><table className="data-table member-activity-table"><caption className="sr-only">Faction member activity, status, and owner-managed follow-up state</caption><thead><tr><th>Member</th><th>Faction position</th><th>Last activity</th><th>Smart signal</th><th>Torn status</th><th>Managed state</th><th><span className="sr-only">Member actions</span></th></tr></thead><tbody>{pagedRows.map((row) => <MemberRosterTableRow key={row.member.tornId} row={row} canManage={canManage} onInspect={() => inspect(row.member)} />)}</tbody></table>{filteredRows.length === 0 && <div className="table-empty">No members match the selected activity view and filters.</div>}</div>
        <Pagination page={currentRosterPage} totalPages={rosterPages} totalItems={filteredRows.length} pageSize={ROSTER_PAGE_SIZE} itemLabel="members" onChange={setRosterPage} />
        <footer className="member-activity-provenance"><ShieldCheck size={14} /><p><strong>Torn activity stays source-labelled.</strong><span>Last action and status come from Torn API v2. Alerts, holidays, watches, and notes are Chainward policy records.</span></p><em className={`registry-state registry-state--${activity.databaseAvailable ? "ready" : "attention"}`}><i />{activity.databaseAvailable ? "Intelligence ready" : "Storage required"}</em></footer>
      </section>
    </section>

    <section id="members-panel-patterns" className="member-workspace-panel" role="tabpanel" aria-labelledby="members-tab-patterns" hidden={workspaceView !== "patterns"}><InactivityHistory periods={activity.inactivityPeriods} checkedAt={rosterResult.checkedAt} databaseAvailable={activity.databaseAvailable} /></section>

    <section id="members-panel-controls" className="member-workspace-panel" role="tabpanel" aria-labelledby="members-tab-controls" hidden={workspaceView !== "controls"}><ActivityControls thresholdDays={thresholdDays} criticalAfterDays={criticalAfterDays} policyDirty={policyDirty} policyDisabled={policyDisabled} savingPolicy={savingPolicy} updatedByName={activity.policy.updatedByName} canManage={canManage} audit={activity.audit} onThresholdChange={setThresholdDays} onSave={() => void saveThreshold()} /></section>

    <Dialog open={Boolean(selected)} className="dialog--member-activity" title={selected ? `Manage ${selected.name}` : "Manage member activity"} description="This changes Chainward’s activity policy only. It does not alter Torn membership or status." confirmLabel={canManage ? "Save activity record" : "Close"} cancelLabel="Cancel" hideCancel={!canManage} confirmDisabled={canManage && (!activity.databaseAvailable || !faction || holidayDateInvalid)} onConfirm={canManage ? save : async () => undefined} onClose={() => setSelected(null)}>
      {selected && <div className="member-activity-editor"><div className="member-activity-editor__identity"><TornUserLink name={selected.name} tornUserId={selected.tornId} detail={`${selected.position || "Unassigned"} · ${selected.lastAction}`} /></div>{canManage ? <><div className="member-activity-state-options">{([ ["STANDARD", ShieldCheck, "Standard", "Use the saved owner inactivity threshold."], ["HOLIDAY", Umbrella, "On holiday", "Exclude from inactivity alerts until return."], ["WATCH", Eye, "Watch", "Keep visible for deliberate owner follow-up."] ] as const).map(([value, Icon, label, detail]) => <button type="button" key={value} aria-pressed={draftState === value} className={draftState === value ? "member-activity-state-option--active" : undefined} onClick={() => setDraftState(value)}><span><Icon size={16} /></span><p><strong>{label}</strong><small>{detail}</small></p>{draftState === value && <Check size={14} />}</button>)}</div>{draftState === "HOLIDAY" && <label className={`member-activity-date${holidayDateInvalid ? " member-activity-date--invalid" : ""}`}><span>Protected through <small>Optional</small></span><input type="date" min={utcDateInputValue(new Date())} value={holidayUntil} aria-invalid={holidayDateInvalid || undefined} onChange={(event) => setHolidayUntil(event.target.value)} /><small>{holidayDateInvalid ? "Choose today or a future return date." : "The selected calendar date is protected in UTC. Leave blank for an open-ended exemption."}</small></label>}<label className="member-activity-note"><span>Internal activity note <small>{note.length}/500</small></span><textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder={draftState === "HOLIDAY" ? "Reason or return context…" : draftState === "WATCH" ? "What should leaders follow up on?" : "Optional note about returning to standard policy…"} /></label><div className="access-safety-note"><ShieldCheck size={15} /><p><strong>Verified write boundary</strong><span>The server rechecks your member-management permission, faction, and current roster before saving.</span></p></div></> : <div className="member-activity-readonly"><ShieldCheck size={16} /><p><strong>Read-only activity access</strong><span>An Administrator or platform owner can change holiday, watch, and alert-policy records.</span></p></div>}</div>}
    </Dialog>
  </div>;
}

function InactivityHistory({ periods, checkedAt, databaseAvailable }: { periods: MemberInactivityPeriod[]; checkedAt: string; databaseAvailable: boolean }) {
  const [historyView, setHistoryView] = useState<HistoryView>("members");
  const [memberPage, setMemberPage] = useState(1);
  const [periodPage, setPeriodPage] = useState(1);
  const insights = useMemo(() => buildMemberInactivityInsights(periods, checkedAt), [checkedAt, periods]);
  const parsedCheckedAt = Date.parse(checkedAt);
  const checkedAtSeconds = Math.floor((Number.isNaN(parsedCheckedAt) ? Date.now() : parsedCheckedAt) / 1_000);
  const memberPages = Math.max(1, Math.ceil(insights.patterns.length / HISTORY_PAGE_SIZE));
  const currentMemberPage = Math.min(memberPage, memberPages);
  const visiblePatterns = insights.patterns.slice((currentMemberPage - 1) * HISTORY_PAGE_SIZE, currentMemberPage * HISTORY_PAGE_SIZE);
  const periodPages = Math.max(1, Math.ceil(periods.length / HISTORY_PAGE_SIZE));
  const currentPeriodPage = Math.min(periodPage, periodPages);
  const visiblePeriods = periods.slice((currentPeriodPage - 1) * HISTORY_PAGE_SIZE, currentPeriodPage * HISTORY_PAGE_SIZE);

  return <section className="panel member-inactivity-history"><div className="section-heading"><div><h2>Inactivity patterns</h2><p>Durable gaps of 24 hours or longer, grouped for quick comparison</p></div><span className="analytics-panel-icon"><CalendarRange size={17} /></span></div>{periods.length ? <><div className="member-inactivity-summary" aria-label="Inactivity history summary"><HistoryMetric label="Periods recorded" value={insights.recordedPeriods.toLocaleString()} detail={`${insights.completedPeriods} completed`} /><HistoryMetric label="Open now" value={insights.openPeriods.toLocaleString()} detail="Still inactive" tone={insights.openPeriods ? "attention" : undefined} /><HistoryMetric label="Repeat members" value={insights.repeatMembers.toLocaleString()} detail="Two or more periods" /><HistoryMetric label="Average completed" value={insights.completedPeriods ? formatPeriodDuration(insights.averageCompletedSeconds) : "—"} detail="Across resolved periods" /></div><div className="member-history-switcher" role="tablist" aria-label="Inactivity history view"><button id="inactivity-tab-members" type="button" role="tab" aria-controls="inactivity-panel-members" aria-selected={historyView === "members"} className={historyView === "members" ? "member-history-switcher__active" : undefined} onClick={() => setHistoryView("members")}><Repeat2 size={14} /> By member <span>{insights.patterns.length}</span></button><button id="inactivity-tab-periods" type="button" role="tab" aria-controls="inactivity-panel-periods" aria-selected={historyView === "periods"} className={historyView === "periods" ? "member-history-switcher__active" : undefined} onClick={() => setHistoryView("periods")}><Clock3 size={14} /> Period log <span>{periods.length}</span></button></div><section id="inactivity-panel-members" role="tabpanel" aria-labelledby="inactivity-tab-members" className="member-inactivity-patterns" hidden={historyView !== "members"}><header><Repeat2 size={15} /><div><h3>Member patterns</h3><p>Frequency, typical start day, and duration by member</p></div></header><div className="table-scroll" role="region" aria-label="Member inactivity patterns" tabIndex={0}><table className="data-table"><thead><tr><th>Member</th><th>Periods</th><th>Average</th><th>Longest</th><th>Typical start</th><th>Current</th></tr></thead><tbody>{visiblePatterns.map((pattern) => <tr key={pattern.tornUserId}><td><TornUserLink name={pattern.memberName} tornUserId={pattern.tornUserId} /></td><td><strong>{pattern.periodCount}</strong><small className="cell-subtext">{pattern.completedCount} completed</small></td><td>{formatPeriodDuration(pattern.averageDurationSeconds)}</td><td>{formatPeriodDuration(pattern.longestDurationSeconds)}</td><td>{pattern.periodCount > 1 ? pattern.typicalStartDay : <span className="muted-value">More data needed</span>}</td><td>{pattern.currentPeriod ? <span className="inactivity-period-state inactivity-period-state--open"><i />Open</span> : <span className="inactivity-period-state"><i />Resolved</span>}</td></tr>)}</tbody></table></div><Pagination page={currentMemberPage} totalPages={memberPages} totalItems={insights.patterns.length} pageSize={HISTORY_PAGE_SIZE} itemLabel="members" onChange={setMemberPage} /></section><section id="inactivity-panel-periods" role="tabpanel" aria-labelledby="inactivity-tab-periods" className="member-inactivity-log" hidden={historyView !== "periods"}><header><Clock3 size={15} /><div><h3>Period log</h3><p>Newest first; ongoing gaps update on each verified roster check</p></div></header><div className="table-scroll" role="region" aria-label="Member inactivity period log" tabIndex={0}><table className="data-table"><thead><tr><th>Member</th><th>Inactivity began</th><th>Return / status</th><th>Duration</th><th>Context</th></tr></thead><tbody>{visiblePeriods.map((period) => <tr key={period.id}><td><TornUserLink name={period.memberName} tornUserId={period.tornUserId} /></td><td><time dateTime={period.startedAt}>{formatPeriodDate(period.startedAt)}</time><small className="cell-subtext">Qualified {formatPeriodDate(period.qualifyingAt)}</small></td><td>{period.endedAt ? <><time dateTime={period.endedAt}>{formatPeriodDate(period.endedAt)}</time><small className="cell-subtext">Activity resumed</small></> : <><span className="inactivity-period-state inactivity-period-state--open"><i />Ongoing</span><small className="cell-subtext">Observed {formatPeriodDate(period.lastObservedAt)}</small></>}</td><td><strong>{formatPeriodDuration(periodDurationSeconds(period, checkedAtSeconds))}</strong></td><td><PeriodContext period={period} /></td></tr>)}</tbody></table></div><Pagination page={currentPeriodPage} totalPages={periodPages} totalItems={periods.length} pageSize={HISTORY_PAGE_SIZE} itemLabel="periods" onChange={setPeriodPage} /></section><footer className="member-inactivity-history__note"><ShieldCheck size={14} /><p><strong>Dates are source-grounded.</strong><span>Start and return times come from Torn last_action. First observed records when Chainward detected the gap.</span></p></footer></> : <div className="member-inactivity-empty"><CalendarRange size={21} /><div><strong>{databaseAvailable ? "No inactivity periods recorded yet" : "Inactivity history needs storage"}</strong><p>{databaseAvailable ? "Periods appear when a verified roster check finds a member inactive for at least 24 hours." : "Create or reconnect workspace storage to preserve inactivity periods across roster checks."}</p></div></div>}</section>;
}

function ActivityControls({ thresholdDays, criticalAfterDays, policyDirty, policyDisabled, savingPolicy, updatedByName, canManage, audit, onThresholdChange, onSave }: { thresholdDays: number; criticalAfterDays: number; policyDirty: boolean; policyDisabled: boolean; savingPolicy: boolean; updatedByName: string | null; canManage: boolean; audit: MemberActivityAuditEvent[]; onThresholdChange: (days: number) => void; onSave: () => void }) {
  return <div className="member-controls-stack"><section className="panel member-policy-panel"><div className="section-heading"><div><h2>Alert policy</h2><p>Set when members enter the owner review and critical queues</p></div><span className="analytics-panel-icon"><BellRing size={17} /></span></div><div className="member-policy-panel__body"><div className="member-policy-control"><label htmlFor="member-alert-threshold">Review after</label><div><select id="member-alert-threshold" value={thresholdDays} disabled={policyDisabled} onChange={(event) => onThresholdChange(Number(event.target.value))}>{Array.from({ length: 30 }, (_, index) => index + 1).map((days) => <option key={days} value={days}>{days} day{days === 1 ? "" : "s"}</option>)}</select><button type="button" className="button button--primary" disabled={policyDisabled || !policyDirty} onClick={onSave}>{savingPolicy && <Spinner size={12} label="Saving activity policy" />}{savingPolicy ? "Saving…" : "Save policy"}</button></div><small aria-live="polite">{policyDirty ? `Previewing ${thresholdDays} days · save to apply` : canManage ? updatedByName ? `Last saved by ${updatedByName}` : "Saved faction policy" : "Owner-managed policy"}</small></div><div className="member-policy-facts"><article><AlarmClock size={16} /><div><small>Review queue</small><strong>{thresholdDays} day{thresholdDays === 1 ? "" : "s"}</strong></div></article><article><ShieldAlert size={16} /><div><small>Critical escalation</small><strong>{criticalAfterDays} days</strong></div></article><article><CalendarRange size={16} /><div><small>History qualification</small><strong>Fixed at 24 hours</strong></div></article></div></div></section><ActivityAudit audit={audit} /></div>;
}

function ActivityAudit({ audit }: { audit: MemberActivityAuditEvent[] }) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(audit.length / AUDIT_PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visibleAudit = audit.slice((currentPage - 1) * AUDIT_PAGE_SIZE, currentPage * AUDIT_PAGE_SIZE);
  return <section className="panel member-activity-audit"><div className="section-heading"><div><h2>Management history</h2><p>Holiday, watch, and owner-policy changes</p></div><span className="analytics-panel-icon"><Clock3 size={17} /></span></div>{audit.length ? <><div>{visibleAudit.map((event) => { const policyEvent = event.tornUserId === 0; return <article key={event.id}><span>{auditSymbol(event.action, policyEvent)}</span><div>{policyEvent ? <strong>Faction activity policy</strong> : <TornUserName name={event.memberName} tornUserId={event.tornUserId} />}<p>{auditLabel(event.action, event.state, policyEvent)}{event.note ? ` · ${event.note}` : ""}</p></div><TornUserName name={event.actorName} tornUserId={event.actorTornUserId} detail="Updated by" /><time dateTime={event.createdAt}>{formatAuditTime(event.createdAt)}</time></article>; })}</div><Pagination page={currentPage} totalPages={pages} totalItems={audit.length} pageSize={AUDIT_PAGE_SIZE} itemLabel="changes" onChange={setPage} /></> : <div className="access-audit-empty"><ShieldCheck size={17} /><span><strong>No management changes recorded</strong><small>The first holiday, watch, or threshold update will appear here.</small></span></div>}</section>;
}

function Pagination({ page, totalPages, totalItems, pageSize, itemLabel, onChange }: { page: number; totalPages: number; totalItems: number; pageSize: number; itemLabel: string; onChange: (page: number) => void }) {
  const first = totalItems ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(totalItems, page * pageSize);
  return <footer className="member-pagination"><span>{totalItems ? `${first}–${last} of ${totalItems} ${itemLabel}` : `0 ${itemLabel}`}</span><div><button type="button" disabled={page <= 1} aria-label={`Previous ${itemLabel} page`} onClick={() => onChange(page - 1)}><ChevronLeft size={14} /></button><em>Page {page} of {totalPages}</em><button type="button" disabled={page >= totalPages} aria-label={`Next ${itemLabel} page`} onClick={() => onChange(page + 1)}><ChevronRight size={14} /></button></div></footer>;
}

function compareRows(left: MemberActivityAssessment, right: MemberActivityAssessment, sort: ActivitySort): number {
  if (sort === "name") return left.member.name.localeCompare(right.member.name);
  if (sort === "tenure") return right.member.daysInFaction - left.member.daysInFaction;
  if (sort === "level") return right.member.level - left.member.level || left.member.name.localeCompare(right.member.name);
  if (sort === "recent") return left.ageSeconds - right.ageSeconds;
  if (sort === "inactive") return right.ageSeconds - left.ageSeconds;
  return Number(right.critical) - Number(left.critical) || Number(right.needsAttention) - Number(left.needsAttention) || right.riskScore - left.riskScore || right.ageSeconds - left.ageSeconds;
}

function isWorkspaceView(value: string | null): value is WorkspaceView { return value === "overview" || value === "roster" || value === "patterns" || value === "controls"; }
function isActivityView(value: string | null): value is ActivityView { return value === "all" || value === "attention" || value === "critical" || value === "dueSoon" || value === "active" || value === "holiday" || value === "expired" || value === "watch"; }
function MemberRosterTableRow({ row, canManage, onInspect }: { row: MemberActivityAssessment; canManage: boolean; onInspect: () => void }) {
  return <tr className={`member-activity-row--${rosterTone(row)}`}>
    <td data-label="Member"><TornUserLink name={row.member.name} tornUserId={row.member.tornId} detail={`Level ${row.member.level}`} /></td>
    <td data-label="Faction position">{row.member.position || <span className="muted-value">Unassigned</span>}<small className="cell-subtext">{row.member.daysInFaction.toLocaleString()} days</small></td>
    <td data-label="Last activity"><strong>{row.member.lastAction}</strong><small className="cell-subtext">{formatAge(row.ageSeconds)}</small></td>
    <td data-label="Smart signal"><span className={`activity-band activity-band--${bandClass(row.band)}`}><i />{row.band}</span><small className="cell-subtext member-activity-reason">{row.reason}</small></td>
    <td data-label="Torn status"><span className={`member-status member-status--${statusClass(row.member.status)}`} title={row.member.statusDescription}><i />{row.member.status}</span></td>
    <td data-label="Managed state"><ManagedState row={row} /></td>
    <td data-label="Actions"><div className="member-row-actions"><Link href={`/members/${row.member.tornId}`}><FileUser size={13} /> Report</Link><button type="button" className="row-manage-button" onClick={onInspect}>{canManage ? row.record ? "Update" : "Manage" : "Inspect"}</button></div></td>
  </tr>;
}
function MemberRosterListRow({ row, canManage, onInspect }: { row: MemberActivityAssessment; canManage: boolean; onInspect: () => void }) {
  return <li className={`member-roster-list-row member-roster-list-row--${rosterTone(row)}`}>
    <div className="member-roster-list-row__identity"><TornUserLink name={row.member.name} tornUserId={row.member.tornId} detail={`${row.member.position || "Unassigned"} · Level ${row.member.level}`} /></div>
    <div className="member-roster-list-row__status"><span className={`member-status member-status--${statusClass(row.member.status)}`} title={row.member.statusDescription}><i />{row.member.status}</span><small title={formatAge(row.ageSeconds)}>Active {row.member.lastAction}</small></div>
    <div className="member-roster-list-row__signal"><span className={`activity-band activity-band--${bandClass(row.band)}`} title={row.reason}><i />{row.band}</span>{row.record && <ManagedState row={row} />}</div>
    <details className="member-roster-list-row__details"><summary>Activity details</summary><p>{row.reason}</p><p>{row.member.statusDescription} · {row.member.daysInFaction.toLocaleString()} days in faction</p>{row.record?.note && <p>Manager note: {row.record.note}</p>}<button type="button" className="row-manage-button" onClick={onInspect}>{canManage ? "Manage activity" : "Inspect activity"}</button></details>
    <Link className="member-roster-list-row__report" href={`/members/${row.member.tornId}`} aria-label={`Open report for ${row.member.name}`}><FileUser size={14} /> Report</Link>
  </li>;
}
function ActivityStat({ icon: Icon, label, value, detail, tone }: { icon: typeof UsersRound; label: string; value: number | null; detail: string; tone?: "attention" | "critical" | "ready" }) { return <article className={tone ? `member-activity-stat--${tone}` : undefined}><span><Icon size={18} /></span><div><small>{label}</small><strong>{value === null ? "—" : value.toLocaleString()}</strong><p>{detail}</p></div></article>; }
function HistoryMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "attention" }) { return <article className={tone ? `member-inactivity-summary__${tone}` : undefined}><small>{label}</small><strong>{value}</strong><p>{detail}</p></article>; }
function PeriodContext({ period }: { period: MemberInactivityPeriod }) { if (!period.holidayProtected && !period.watchListed) return <span className="muted-value">Standard policy</span>; return <div className="inactivity-period-context">{period.holidayProtected && <span><Umbrella size={11} />Holiday</span>}{period.watchListed && <span><Eye size={11} />Watch</span>}</div>; }
function ManagedState({ row }: { row: MemberActivityAssessment }) { if (!row.record) return <span className="managed-state managed-state--standard"><ShieldCheck size={12} />Standard</span>; if (row.record.state === "WATCH") return <span className="managed-state managed-state--watch" title={row.record.note || "Manually watched"}><Eye size={12} />Watch</span>; return <span className={`managed-state managed-state--${row.holidayActive ? "holiday" : "expired"}`} title={row.record.note || undefined}><Umbrella size={12} />{row.holidayExpired ? "Holiday expired" : row.record.holidayUntil ? `Holiday through ${new Date(row.record.holidayUntil).toLocaleDateString("en-GB", { timeZone: "UTC" })}` : "Holiday"}</span>; }
function formatAge(seconds: number): string { if (seconds < 3_600) return `${Math.max(0, Math.floor(seconds / 60))} minutes inactive`; if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} hours inactive`; const days = Math.floor(seconds / 86_400); return `${days} day${days === 1 ? "" : "s"} inactive`; }
function statusClass(status: string): string { const value = status.toLowerCase(); if (value.includes("okay")) return "online"; if (value.includes("hospital")) return "hospital"; if (value.includes("travel")) return "idle"; return "offline"; }
function bandClass(band: MemberActivityAssessment["band"]): string { return band.toLowerCase().replaceAll(" ", "-"); }
function rosterTone(row: MemberActivityAssessment): "current" | "protected" | "watch" | "expired" | "attention" | "critical" { if (row.critical) return "critical"; if (row.holidayActive) return "protected"; if (row.holidayExpired) return "expired"; if (row.record?.state === "WATCH") return "watch"; if (row.needsAttention || row.band === "Due soon") return "attention"; return "current"; }
function auditSymbol(action: string, policyEvent: boolean): string { return policyEvent ? "!" : action === "HOLIDAY_SET" ? "☂" : action === "WATCH_SET" ? "◉" : action === "CLEARED" ? "✓" : "↻"; }
function auditLabel(action: string, state: ManagedMemberActivityState | "STANDARD", policyEvent: boolean): string { return policyEvent ? "Owner alert threshold updated" : action === "HOLIDAY_SET" ? "Holiday exemption added" : action === "WATCH_SET" ? "Activity watch added" : action === "CLEARED" ? "Returned to standard policy" : state === "HOLIDAY" ? "Holiday record updated" : "Watch record updated"; }
function formatAuditTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
function formatPeriodDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unknown" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date); }
function formatPeriodDuration(seconds: number): string { if (!Number.isFinite(seconds) || seconds <= 0) return "—"; if (seconds < 86_400) return `${Math.max(1, Math.round(seconds / 3_600))}h`; const days = seconds / 86_400; return days < 10 ? `${days.toFixed(1)}d` : `${Math.round(days)}d`; }
function utcDateInputValue(date: Date): string { return date.toISOString().slice(0, 10); }
