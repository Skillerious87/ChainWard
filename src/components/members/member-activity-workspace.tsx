"use client";

import { Activity, AlarmClock, Check, ChevronsUpDown, Clock3, Eye, ListFilter, RefreshCw, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, Umbrella, UserRoundCheck, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { updateMemberActivity, updateMemberActivityPolicy } from "@/app/(platform)/members/actions";
import { ExportButton } from "@/components/ui/action-controls";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { TornUserLink, TornUserName } from "@/components/ui/torn-user-link";
import { notify } from "@/lib/client-actions";
import { assessMemberActivity, criticalThreshold, type MemberActivityAssessment } from "@/lib/members/member-activity-intelligence";
import type { ManagedMemberActivityState, MemberActivityWorkspace as ActivityWorkspace, MemberActivityInputState } from "@/lib/members/member-activity-store";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";
import type { TornDataResult, TornRosterMember } from "@/lib/torn/workspace-types";

type ActivityView = "all" | "attention" | "critical" | "dueSoon" | "active" | "holiday" | "expired" | "watch";
type ActivitySort = "attention" | "recent" | "inactive" | "name" | "level" | "tenure";

export function MemberActivityWorkspace({ rosterResult, telemetry, activity, canManage }: { rosterResult: TornDataResult<TornRosterMember[]>; telemetry: WorkspaceTelemetry; activity: ActivityWorkspace; canManage: boolean }) {
  const router = useRouter();
  const members = rosterResult.data;
  const faction = telemetry.faction;
  const parsedCheckedAt = Date.parse(rosterResult.checkedAt);
  const checkedAt = Math.floor((Number.isNaN(parsedCheckedAt) ? Date.now() : parsedCheckedAt) / 1_000);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ActivityView>("all");
  const [position, setPosition] = useState("All positions");
  const [tornStatus, setTornStatus] = useState("All statuses");
  const [thresholdDays, setThresholdDays] = useState(activity.policy.thresholdDays);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [sort, setSort] = useState<ActivitySort>("attention");
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
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !normalized || `${row.member.name} ${row.member.tornId} ${row.member.position} ${row.record?.note ?? ""}`.toLowerCase().includes(normalized);
      const matchesPosition = position === "All positions" || (row.member.position || "Unassigned") === position;
      const matchesStatus = tornStatus === "All statuses" || (row.member.status || "Unknown") === tornStatus;
      const matchesView = view === "all"
        || (view === "attention" && row.needsAttention)
        || (view === "critical" && row.critical)
        || (view === "dueSoon" && row.band === "Due soon")
        || (view === "active" && row.ageSeconds <= 86_400)
        || (view === "holiday" && row.holidayActive)
        || (view === "expired" && row.holidayExpired)
        || (view === "watch" && row.record?.state === "WATCH");
      return matchesQuery && matchesPosition && matchesStatus && matchesView;
    }).toSorted((left, right) => compareRows(left, right, sort));
  }, [position, query, rows, sort, tornStatus, view]);

  useEffect(() => {
    const requestedView = new URLSearchParams(window.location.search).get("view");
    if (!isActivityView(requestedView)) return;
    const timer = window.setTimeout(() => setView(requestedView), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function inspect(member: TornRosterMember): void {
    const record = recordById.get(member.tornId);
    setDraftState(record?.state ?? "STANDARD");
    setHolidayUntil(record?.holidayUntil ? record.holidayUntil.slice(0, 10) : "");
    setNote(record?.note ?? "");
    setSelected(member);
  }

  async function save(): Promise<void> {
    if (!selected || !faction) return;
    const result = await updateMemberActivity({ factionId: faction.id, tornUserId: selected.tornId, state: draftState, holidayUntil: draftState === "HOLIDAY" && holidayUntil ? new Date(`${holidayUntil}T23:59:59.999Z`).toISOString() : null, note });
    notify({ title: result.ok ? "Member activity updated" : "Activity was not changed", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
    router.refresh();
  }

  async function saveThreshold(nextThreshold: number): Promise<void> {
    const previous = thresholdDays;
    setThresholdDays(nextThreshold);
    if (!canManage || !faction || !activity.databaseAvailable) return;
    setSavingPolicy(true);
    const result = await updateMemberActivityPolicy({ factionId: faction.id, thresholdDays: nextThreshold });
    setSavingPolicy(false);
    notify({ title: result.ok ? "Owner alert policy saved" : "Alert policy was not changed", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) {
      setThresholdDays(previous);
      return;
    }
    router.refresh();
  }

  const exportRows = visible.map((row) => ({ name: row.member.name, tornId: row.member.tornId, factionPosition: row.member.position, level: row.member.level, daysInFaction: row.member.daysInFaction, lastAction: row.member.lastAction, inactivityDays: Number(row.daysInactive.toFixed(2)), riskScore: row.riskScore, smartSignal: row.band, attentionReason: row.reason, tornStatus: row.member.status, managedState: row.record?.state ?? "STANDARD", holidayUntil: row.record?.holidayUntil ?? "", note: row.record?.note ?? "" }));
  const criticalAfterDays = criticalThreshold(thresholdDays);
  const filtersActive = Boolean(query || position !== "All positions" || tornStatus !== "All statuses" || view !== "all");

  function resetFilters(): void {
    setQuery("");
    setPosition("All positions");
    setTornStatus("All statuses");
    setView("all");
  }

  return <div className="page-stack member-activity-workspace">
    <PageHeader eyebrow="Faction readiness" title="Member activity" description="Owner-grade inactivity intelligence with protected absences, escalation signals, and an auditable follow-up policy." actions={<><button className="button button--secondary" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>{refreshing ? <Spinner size={15} label="Refreshing member activity" tone="muted" /> : <RefreshCw size={15} />} {refreshing ? "Refreshing…" : "Refresh roster"}</button><ExportButton filename="chainward-member-activity.csv" label="Export activity" rows={exportRows} /></>} />

    <section className={`member-activity-brief${summary.critical ? " member-activity-brief--critical" : summary.attention ? " member-activity-brief--attention" : ""}`} role="status">
      <span><Activity size={22} /></span>
      <div><p className="eyebrow">Owner inactivity intelligence</p><h2>{summary.critical ? `${summary.critical} critical member alert${summary.critical === 1 ? "" : "s"}.` : summary.attention ? `${summary.attention} member${summary.attention === 1 ? "" : "s"} need owner review.` : "The current roster is within policy."}</h2><p>Owners are alerted after {thresholdDays} inactive day{thresholdDays === 1 ? "" : "s"}; critical escalation begins after {criticalAfterDays}. Active holidays are protected and watch-listed members remain visible.</p></div>
      <label><span>Alert owners after</span><select value={thresholdDays} disabled={!canManage || !activity.databaseAvailable || !faction || savingPolicy} onChange={(event) => void saveThreshold(Number(event.target.value))}>{[1, 2, 3, 5, 7, 10, 14, 21, 30].map((days) => <option key={days} value={days}>{days} day{days === 1 ? "" : "s"}</option>)}</select><small>{savingPolicy && <Spinner size={11} label="Saving activity policy" />}{savingPolicy ? "Saving policy…" : canManage ? "Saved faction policy" : "Owner-managed policy"}</small></label>
    </section>

    <section className="member-activity-stats">
      <ActivityStat icon={UsersRound} label="Verified roster" value={rosterResult.available ? members.length : null} detail="Current Torn members" />
      <ActivityStat icon={UserRoundCheck} label="Active in 24h" value={rosterResult.available ? summary.activeDay : null} detail="Based on Torn last_action" />
      <ActivityStat icon={AlarmClock} label="Needs review" value={rosterResult.available ? summary.attention : null} detail={`After ${thresholdDays} inactive days`} tone={summary.attention ? "attention" : "ready"} />
      <ActivityStat icon={ShieldAlert} label="Critical alerts" value={rosterResult.available ? summary.critical : null} detail={`Escalates after ${criticalAfterDays} days`} tone={summary.critical ? "critical" : "ready"} />
      <ActivityStat icon={Umbrella} label="On holiday" value={activity.databaseAvailable ? summary.holiday : null} detail="Protected exemptions" />
      <ActivityStat icon={Eye} label="Watch list" value={activity.databaseAvailable ? summary.watch : null} detail="Manual follow-up" />
    </section>

    <section className="panel member-priority-queue">
      <div className="section-heading"><div><h2>Smart follow-up queue</h2><p>Highest-risk members and approaching thresholds, ranked by the current policy</p></div><span className="analytics-panel-icon"><ShieldAlert size={17} /></span></div>
      {priorityQueue.length ? <div className="member-priority-queue__grid">{priorityQueue.map((row, index) => <article key={row.member.tornId} className={row.critical ? "member-priority-card--critical" : undefined}><header><span>#{index + 1}</span><em>Risk {row.riskScore}</em></header><TornUserLink name={row.member.name} tornUserId={row.member.tornId} detail={`${row.member.position || "Unassigned"} · ${formatAge(row.ageSeconds)}`} /><p>{row.reason}</p><footer><span className={`activity-band activity-band--${bandClass(row.band)}`}><i />{row.band}</span><button onClick={() => inspect(row.member)}>{canManage ? "Manage" : "Inspect"}</button></footer></article>)}</div> : <div className="member-priority-queue__empty"><ShieldCheck size={18} /><div><strong>No follow-up queue</strong><p>No member is at or approaching the current inactivity threshold.</p></div></div>}
    </section>

    <section className="data-section member-activity-table-section">
      <div className="section-heading member-activity-table-heading"><div><h2>Roster activity tracker</h2><p>{visible.length} of {members.length} verified members match this view</p></div><div className="table-tools"><label className="search-field"><Search size={15} /><span className="sr-only">Search member activity</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Member, position, ID, or note" /></label><label className="member-activity-select"><SlidersHorizontal size={14} /><span className="sr-only">Faction position</span><select value={position} onChange={(event) => setPosition(event.target.value)}>{positions.map((item) => <option key={item}>{item}</option>)}</select></label><label className="member-activity-select"><Activity size={14} /><span className="sr-only">Torn status</span><select value={tornStatus} onChange={(event) => setTornStatus(event.target.value)}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>{filtersActive && <button className="member-filter-reset" onClick={resetFilters}><ListFilter size={13} /> Clear</button>}</div></div>
      <div className="member-activity-tabs" role="tablist" aria-label="Member activity view">{([ ["all", "All members", members.length], ["attention", "Needs review", summary.attention], ["critical", "Critical", summary.critical], ["dueSoon", "Due soon", summary.dueSoon], ["active", "Active 24h", summary.activeDay], ["holiday", "Holiday", summary.holiday], ["expired", "Expired holiday", summary.expired], ["watch", "Watch list", summary.watch] ] as const).map(([value, label, count]) => <button key={value} role="tab" aria-selected={view === value} className={view === value ? "member-activity-tab--active" : undefined} onClick={() => setView(value)}>{label}<span>{count}</span></button>)}</div>
      <div className="member-activity-sort"><span>Sort</span>{([ ["attention", "Priority"], ["recent", "Most recent"], ["inactive", "Longest inactive"], ["name", "Name"], ["level", "Level"], ["tenure", "Tenure"] ] as const).map(([value, label]) => <button className={sort === value ? "member-activity-sort--active" : undefined} key={value} onClick={() => setSort(value)}>{label}{sort === value && <ChevronsUpDown size={12} />}</button>)}</div>
      <div className="table-scroll"><table className="data-table member-activity-table"><thead><tr><th>Member</th><th>Faction position</th><th>Last activity</th><th>Smart signal</th><th>Torn status</th><th>Managed state</th><th><span className="sr-only">Manage</span></th></tr></thead><tbody>{visible.map((row) => <tr key={row.member.tornId} className={row.critical ? "member-activity-row--critical" : row.needsAttention ? "member-activity-row--attention" : undefined}><td><TornUserLink name={row.member.name} tornUserId={row.member.tornId} detail={`Level ${row.member.level}`} /></td><td>{row.member.position || <span className="muted-value">Unassigned</span>}<small className="cell-subtext">{row.member.daysInFaction.toLocaleString()} days</small></td><td><strong>{row.member.lastAction}</strong><small className="cell-subtext">{formatAge(row.ageSeconds)}</small></td><td><span className={`activity-band activity-band--${bandClass(row.band)}`}><i />{row.band}</span><small className="cell-subtext member-activity-reason">{row.reason}</small></td><td><span className={`member-status member-status--${statusClass(row.member.status)}`} title={row.member.statusDescription}><i />{row.member.status}</span></td><td><ManagedState row={row} /></td><td><button className="row-manage-button" onClick={() => inspect(row.member)}>{canManage ? row.record ? "Update" : "Manage" : "Inspect"}</button></td></tr>)}</tbody></table>{visible.length === 0 && <div className="table-empty">No members match the selected activity view and filters.</div>}</div>
      <footer className="member-activity-provenance"><ShieldCheck size={14} /><p><strong>Torn activity stays source-labelled.</strong><span>Last action and status come from Torn API v2. Alerts, holidays, watches, and notes are deliberate Chainward policy records.</span></p><em className={`registry-state registry-state--${activity.databaseAvailable ? "ready" : "attention"}`}><i />{activity.databaseAvailable ? "Intelligence ready" : "Storage required"}</em></footer>
    </section>

    <section className="panel member-activity-audit"><div className="section-heading"><div><h2>Activity management history</h2><p>Latest holiday, watch, and owner-policy changes</p></div><span className="analytics-panel-icon"><Clock3 size={17} /></span></div>{activity.audit.length ? <div>{activity.audit.slice(0, 10).map((event) => { const policyEvent = event.tornUserId === 0; return <article key={event.id}><span>{auditSymbol(event.action, policyEvent)}</span><div>{policyEvent ? <strong>Faction activity policy</strong> : <TornUserName name={event.memberName} tornUserId={event.tornUserId} />}<p>{auditLabel(event.action, event.state, policyEvent)}{event.note ? ` · ${event.note}` : ""}</p></div><TornUserName name={event.actorName} tornUserId={event.actorTornUserId} detail="Updated by" /><time dateTime={event.createdAt}>{formatAuditTime(event.createdAt)}</time></article>; })}</div> : <div className="access-audit-empty"><ShieldCheck size={17} /><span><strong>No activity-management changes recorded</strong><small>The first holiday, watch, or threshold update will create an audit entry.</small></span></div>}</section>

    <Dialog open={Boolean(selected)} className="dialog--member-activity" title={selected ? `Manage ${selected.name}` : "Manage member activity"} description="This changes Chainward’s activity policy only. It does not alter Torn membership or status." confirmLabel={canManage ? "Save activity record" : "Close"} cancelLabel="Cancel" hideCancel={!canManage} confirmDisabled={canManage && (!activity.databaseAvailable || !faction)} onConfirm={canManage ? save : async () => undefined} onClose={() => setSelected(null)}>
      {selected && <div className="member-activity-editor"><div className="member-activity-editor__identity"><TornUserLink name={selected.name} tornUserId={selected.tornId} detail={`${selected.position || "Unassigned"} · ${selected.lastAction}`} /></div>{canManage ? <><div className="member-activity-state-options">{([ ["STANDARD", ShieldCheck, "Standard", "Use the saved owner inactivity threshold."], ["HOLIDAY", Umbrella, "On holiday", "Exclude from inactivity alerts until return."], ["WATCH", Eye, "Watch", "Keep visible for deliberate owner follow-up."] ] as const).map(([value, Icon, label, detail]) => <button key={value} className={draftState === value ? "member-activity-state-option--active" : undefined} onClick={() => setDraftState(value)}><span><Icon size={16} /></span><p><strong>{label}</strong><small>{detail}</small></p>{draftState === value && <Check size={14} />}</button>)}</div>{draftState === "HOLIDAY" && <label className="member-activity-date"><span>Protected through <small>Optional</small></span><input type="date" min={utcDateInputValue(new Date())} value={holidayUntil} onChange={(event) => setHolidayUntil(event.target.value)} /><small>The selected calendar date is protected in UTC. Leave blank for an open-ended exemption.</small></label>}<label className="member-activity-note"><span>Internal activity note <small>{note.length}/500</small></span><textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder={draftState === "HOLIDAY" ? "Reason or return context…" : draftState === "WATCH" ? "What should leaders follow up on?" : "Optional note about returning to standard policy…"} /></label><div className="access-safety-note"><ShieldCheck size={15} /><p><strong>Verified write boundary</strong><span>The server rechecks your member-management permission, faction, and current roster before saving.</span></p></div></> : <div className="member-activity-readonly"><ShieldCheck size={16} /><p><strong>Read-only activity access</strong><span>An Administrator or platform owner can change holiday, watch, and alert-policy records.</span></p></div>}</div>}
    </Dialog>
  </div>;
}

function compareRows(left: MemberActivityAssessment, right: MemberActivityAssessment, sort: ActivitySort): number {
  if (sort === "name") return left.member.name.localeCompare(right.member.name);
  if (sort === "tenure") return right.member.daysInFaction - left.member.daysInFaction;
  if (sort === "level") return right.member.level - left.member.level || left.member.name.localeCompare(right.member.name);
  if (sort === "recent") return left.ageSeconds - right.ageSeconds;
  if (sort === "inactive") return right.ageSeconds - left.ageSeconds;
  return Number(right.critical) - Number(left.critical) || Number(right.needsAttention) - Number(left.needsAttention) || right.riskScore - left.riskScore || right.ageSeconds - left.ageSeconds;
}

function isActivityView(value: string | null): value is ActivityView { return value === "all" || value === "attention" || value === "critical" || value === "dueSoon" || value === "active" || value === "holiday" || value === "expired" || value === "watch"; }

function ActivityStat({ icon: Icon, label, value, detail, tone }: { icon: typeof UsersRound; label: string; value: number | null; detail: string; tone?: "attention" | "critical" | "ready" }) { return <article className={tone ? `member-activity-stat--${tone}` : undefined}><span><Icon size={18} /></span><div><small>{label}</small><strong>{value === null ? "—" : value.toLocaleString()}</strong><p>{detail}</p></div></article>; }
function ManagedState({ row }: { row: MemberActivityAssessment }) { if (!row.record) return <span className="managed-state managed-state--standard"><ShieldCheck size={12} />Standard</span>; if (row.record.state === "WATCH") return <span className="managed-state managed-state--watch" title={row.record.note || "Manually watched"}><Eye size={12} />Watch</span>; return <span className={`managed-state managed-state--${row.holidayActive ? "holiday" : "expired"}`} title={row.record.note || undefined}><Umbrella size={12} />{row.holidayExpired ? "Holiday expired" : row.record.holidayUntil ? `Holiday through ${new Date(row.record.holidayUntil).toLocaleDateString("en-GB", { timeZone: "UTC" })}` : "Holiday"}</span>; }
function formatAge(seconds: number): string { if (seconds < 3_600) return `${Math.max(0, Math.floor(seconds / 60))} minutes inactive`; if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} hours inactive`; const days = Math.floor(seconds / 86_400); return `${days} day${days === 1 ? "" : "s"} inactive`; }
function statusClass(status: string): string { const value = status.toLowerCase(); if (value.includes("okay")) return "online"; if (value.includes("hospital")) return "hospital"; if (value.includes("travel")) return "idle"; return "offline"; }
function bandClass(band: MemberActivityAssessment["band"]): string { return band.toLowerCase().replaceAll(" ", "-"); }
function auditSymbol(action: string, policyEvent: boolean): string { return policyEvent ? "!" : action === "HOLIDAY_SET" ? "☂" : action === "WATCH_SET" ? "◉" : action === "CLEARED" ? "✓" : "↻"; }
function auditLabel(action: string, state: ManagedMemberActivityState | "STANDARD", policyEvent: boolean): string { return policyEvent ? "Owner alert threshold updated" : action === "HOLIDAY_SET" ? "Holiday exemption added" : action === "WATCH_SET" ? "Activity watch added" : action === "CLEARED" ? "Returned to standard policy" : state === "HOLIDAY" ? "Holiday record updated" : "Watch record updated"; }
function formatAuditTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
function utcDateInputValue(date: Date): string { return date.toISOString().slice(0, 10); }
