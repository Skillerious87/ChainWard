"use client";

import {
  ChevronDown,
  Clock3,
  Crosshair,
  ExternalLink,
  Info,
  Pencil,
  Plane,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Swords,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  addTargetAction,
  refreshTargetsAction,
  removeTargetAction,
  updateTargetNoteAction,
} from "@/app/(platform)/targets/actions";
import { ExportButton } from "@/components/ui/action-controls";
import { Dialog } from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { useWorkspaceSectionNavigation } from "@/components/shell/workspace-section-navigation";
import { notify } from "@/lib/client-actions";
import { isAttackableState, MAX_TARGETS, type TargetEntry, type TargetSnapshot } from "@/lib/targets/types";

type SortKey = "lastAction" | "status" | "level" | "name" | "added";
type StatusFilter = "all" | "attackable" | "hospital" | "abroad" | "other";
type View = "list" | "chain" | "abroad";
const VIEWS: readonly View[] = ["list", "chain", "abroad"];
const STALE_MS = 5 * 60_000;

const attackUrl = (id: number) => `https://www.torn.com/loader.php?sid=attack&user2ID=${id}`;
const profileUrl = (id: number) => `https://www.torn.com/profiles.php?XID=${id}`;

interface TargetsWorkspaceProps {
  entries: TargetEntry[];
  snapshots: Record<string, TargetSnapshot>;
  errors: Record<number, string>;
  source: string;
  fetchedAt: string | null;
  nowMs: number;
  connected: boolean;
  storageAvailable: boolean;
}

interface Row {
  entry: TargetEntry;
  snapshot: TargetSnapshot | null;
  error: string | null;
}

export function TargetsWorkspace({ entries, snapshots, errors, source, fetchedAt, nowMs, connected, storageAvailable }: TargetsWorkspaceProps) {
  const router = useRouter();
  const { view: rawView } = useWorkspaceSectionNavigation("targets");
  const view: View = VIEWS.includes(rawView as View) ? (rawView as View) : "list";

  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(nowMs);
  const [addOpen, setAddOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [addNote, setAddNote] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("status");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Countdowns need to move every second. The first render uses the server
  // `nowMs` so the hydrated HTML matches; a frame later we jump to the real
  // clock, then tick.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const frame = window.requestAnimationFrame(tick);
    const timer = window.setInterval(tick, 1_000);
    return () => { window.cancelAnimationFrame(frame); window.clearInterval(timer); };
  }, []);

  const rows = useMemo<Row[]>(() => entries.map((entry) => ({
    entry,
    snapshot: snapshots[String(entry.tornUserId)] ?? null,
    error: errors[entry.tornUserId] ?? null,
  })), [entries, snapshots, errors]);

  const counts = useMemo(() => {
    let attackable = 0, hospital = 0, abroad = 0, other = 0, stale = 0;
    for (const row of rows) {
      const bucket = statusBucket(row.snapshot?.status.state ?? "");
      if (bucket === "attackable") attackable += 1;
      else if (bucket === "hospital") hospital += 1;
      else if (bucket === "abroad") abroad += 1;
      else other += 1;
      const age = row.snapshot ? now - Date.parse(row.snapshot.fetchedAt) : Number.POSITIVE_INFINITY;
      if (!row.snapshot || !Number.isFinite(age) || age > STALE_MS) stale += 1;
    }
    return { total: rows.length, attackable, hospital, abroad, other, stale };
  }, [rows, now]);

  const query = search.trim().toLowerCase();
  const matchesQuery = useCallback((row: Row) => {
    if (!query) return true;
    return `${row.snapshot?.name ?? row.entry.label} ${row.entry.tornUserId} ${row.snapshot?.factionName ?? ""} ${row.entry.note}`
      .toLowerCase().includes(query);
  }, [query]);

  const watchlistRows = useMemo(() => rows
    .filter(matchesQuery)
    .filter((row) => statusFilter === "all" || statusBucket(row.snapshot?.status.state ?? "") === statusFilter)
    .sort((a, b) => compareRows(a, b, sort)),
    [rows, matchesQuery, statusFilter, sort]);

  const chainRows = useMemo(() => rows
    .filter(matchesQuery)
    .filter((row) => {
      const bucket = statusBucket(row.snapshot?.status.state ?? "");
      if (bucket === "attackable") return true;
      if ((bucket === "hospital" || bucket === "jail") && futureUntil(row.snapshot, now)) return true;
      return false;
    })
    .sort((a, b) => chainOrder(a, now) - chainOrder(b, now) || untilMs(a.snapshot, now) - untilMs(b.snapshot, now)),
    [rows, matchesQuery, now]);

  const abroadRows = useMemo(() => rows
    .filter(matchesQuery)
    .filter((row) => statusBucket(row.snapshot?.status.state ?? "") === "abroad")
    .sort((a, b) => untilMs(a.snapshot, now) - untilMs(b.snapshot, now)),
    [rows, matchesQuery, now]);

  const nextReady = chainRows.find((row) => row.snapshot?.attackable) ?? null;

  const exportRows = useMemo(() => rows.map((row) => ({
    name: row.snapshot?.name ?? row.entry.label ?? `Player ${row.entry.tornUserId}`,
    tornUserId: row.entry.tornUserId,
    status: row.snapshot?.status.description ?? "Unknown",
    state: row.snapshot?.status.state ?? "Unknown",
    lastAction: row.snapshot?.lastActionRelative ?? "Unknown",
    level: row.snapshot?.level ?? 0,
    faction: row.snapshot?.factionName ?? "",
    note: row.entry.note,
  })), [rows]);

  function runAction(id: number | null, action: () => Promise<{ ok: boolean; message: string }>): void {
    setBusyId(id);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      notify({ title: result.message, tone: result.ok ? "success" : "warning" });
      if (result.ok) router.refresh();
    });
  }

  async function submitAdd(): Promise<void> {
    const result = await addTargetAction({ reference, note: addNote });
    notify({ title: result.message, tone: result.ok ? "success" : "warning" });
    if (!result.ok) throw new Error(result.message);
    setReference("");
    setAddNote("");
    router.refresh();
  }

  const canAdd = connected && storageAvailable && entries.length < MAX_TARGETS;

  const cardProps = (row: Row) => ({
    row,
    now,
    open: expandedId === row.entry.tornUserId,
    busy: busyId === row.entry.tornUserId && pending,
    disabled: pending,
    onToggle: () => setExpandedId((current) => (current === row.entry.tornUserId ? null : row.entry.tornUserId)),
    onRemove: () => runAction(row.entry.tornUserId, () => removeTargetAction({ tornUserId: row.entry.tornUserId })),
    onSaveNote: (note: string) => runAction(row.entry.tornUserId, () => updateTargetNoteAction({ tornUserId: row.entry.tornUserId, note })),
  });

  return (
    <div className="page-stack targets-workspace">
      <PageHeader
        eyebrow="Personal watchlist"
        title="Targets"
        description="Track Torn players for chaining — status, hospital timers, last activity and health, refreshed from your own key."
        actions={<>
          <button
            className="button button--secondary"
            disabled={pending || !connected || entries.length === 0}
            onClick={() => runAction(null, refreshTargetsAction)}
          >
            {busyId === null && pending ? <Spinner size={15} label="Refreshing targets" tone="muted" /> : <RefreshCw size={15} />}
            {busyId === null && pending ? "Refreshing…" : "Refresh"}
          </button>
          <ExportButton filename="chainward-targets.csv" label="Export" rows={exportRows} />
          <button className="button button--primary" disabled={!canAdd} onClick={() => setAddOpen(true)}>
            <Plus size={15} /> Add target
          </button>
        </>}
      />

      {!connected ? (
        <section className="panel targets-empty">
          <span><Crosshair size={22} /></span>
          <div>
            <strong>Connect a Torn faction first</strong>
            <p>Targets are read with your own verified Torn key. Connect from Settings, then add players here.</p>
          </div>
        </section>
      ) : !storageAvailable ? (
        <section className="panel targets-empty">
          <span><TriangleAlert size={22} /></span>
          <div>
            <strong>Workspace storage is required</strong>
            <p>Your target list is stored per operator. Create workspace storage in Settings to start building one.</p>
          </div>
        </section>
      ) : entries.length === 0 ? (
        <section className="panel targets-empty">
          <span><Swords size={22} /></span>
          <div>
            <strong>No targets yet</strong>
            <p>Add a Torn player by ID or profile link. Chainward keeps a live snapshot of their status and hospital timers.</p>
            <button className="button button--primary" onClick={() => setAddOpen(true)}><Plus size={15} /> Add your first target</button>
          </div>
        </section>
      ) : (
        <>
          {/* ------------------------------------------------------- Watchlist */}
          <section id="targets-panel-list" role="tabpanel" aria-labelledby="targets-tab-list" hidden={view !== "list"}>
            <section className="targets-kpis" aria-label="Target list summary">
              <Kpi label="Targets" value={counts.total} sub={`${MAX_TARGETS - counts.total} slots free`} />
              <Kpi label="Attackable" value={counts.attackable} tone={counts.attackable ? "ok" : undefined} sub="Status is Okay" />
              <Kpi label="In hospital" value={counts.hospital} tone={counts.hospital ? "warn" : undefined} sub="Waiting to clear" />
              <Kpi label="Abroad" value={counts.abroad} sub="Travelling or overseas" />
            </section>

            <section className="panel targets-panel">
              <div className="section-heading">
                <div><h2>Watchlist</h2><p>{watchlistRows.length} of {rows.length} shown</p></div>
                <span className="analytics-panel-icon"><Crosshair size={17} /></span>
              </div>
              <div className="targets-panel__body">
                <div className="targets-tools">
                  <label className="search-field">
                    <Search size={15} /><span className="sr-only">Search targets</span>
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, ID, faction, note" />
                  </label>
                  <div className="targets-chips" role="group" aria-label="Filter by status">
                    {([
                      ["all", "All", counts.total],
                      ["attackable", "Attackable", counts.attackable],
                      ["hospital", "Hospital", counts.hospital],
                      ["abroad", "Abroad", counts.abroad],
                      ["other", "Other", counts.other],
                    ] as const).map(([key, label, count]) => (
                      <button type="button" key={key} aria-pressed={statusFilter === key} className={statusFilter === key ? "targets-chip targets-chip--active" : "targets-chip"} onClick={() => setStatusFilter(key)}>
                        {label}<span>{count}</span>
                      </button>
                    ))}
                  </div>
                  <label className="targets-sortselect">
                    <span className="sr-only">Sort targets</span>
                    <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                      <option value="status">Sort: readiness</option>
                      <option value="lastAction">Sort: last action</option>
                      <option value="level">Sort: level</option>
                      <option value="name">Sort: name</option>
                      <option value="added">Sort: recently added</option>
                    </select>
                  </label>
                </div>

                <ul className="targets-list">
                  {watchlistRows.map((row) => <TargetCard key={row.entry.tornUserId} {...cardProps(row)} />)}
                </ul>
                {watchlistRows.length === 0 && <p className="targets-blank">No targets match this view.</p>}
              </div>
            </section>
          </section>

          {/* ----------------------------------------------------- Chain queue */}
          <section id="targets-panel-chain" role="tabpanel" aria-labelledby="targets-tab-chain" hidden={view !== "chain"}>
            <section className="panel targets-panel">
              <div className="section-heading">
                <div><h2>Chain queue</h2><p>{counts.attackable} ready now · {chainRows.length - counts.attackable} clearing soon</p></div>
                {nextReady && (
                  <a className="button button--primary targets-next" href={attackUrl(nextReady.entry.tornUserId)} target="_blank" rel="noreferrer">
                    <Swords size={14} /> Attack next
                  </a>
                )}
              </div>
              <div className="targets-panel__body">
                <p className="targets-hint"><Info size={13} /> Attackable targets first, then anyone in hospital or jail ordered by who clears soonest. Countdowns are live.</p>
                <ul className="targets-list">
                  {chainRows.map((row) => <TargetCard key={row.entry.tornUserId} {...cardProps(row)} chainMode />)}
                </ul>
                {chainRows.length === 0 && <p className="targets-blank">Nobody on your list is attackable or clearing soon.</p>}
              </div>
            </section>
          </section>

          {/* --------------------------------------------------------- Abroad */}
          <section id="targets-panel-abroad" role="tabpanel" aria-labelledby="targets-tab-abroad" hidden={view !== "abroad"}>
            <section className="panel targets-panel">
              <div className="section-heading">
                <div><h2>Abroad</h2><p>{abroadRows.length} travelling or overseas</p></div>
                <span className="analytics-panel-icon"><Plane size={17} /></span>
              </div>
              <div className="targets-panel__body">
                <p className="targets-hint"><Info size={13} /> Targets you can&apos;t reach until they land. Where Torn reports an arrival time it counts down here.</p>
                <ul className="targets-list">
                  {abroadRows.map((row) => <TargetCard key={row.entry.tornUserId} {...cardProps(row)} chainMode />)}
                </ul>
                {abroadRows.length === 0 && <p className="targets-blank">No targets are abroad right now.</p>}
              </div>
            </section>
          </section>

          <footer className="targets-provenance">
            <ShieldCheck size={14} />
            <p>
              <strong>Read with your key.</strong>{" "}
              <span>
                {fetchedAt ? `Synced ${formatClock(fetchedAt)} from ${source}. ` : ""}
                Snapshots older than 90 seconds refresh automatically when you open this page.
                {counts.stale > 0 ? ` ${counts.stale} shown from an older read.` : ""}
              </span>
            </p>
          </footer>
        </>
      )}

      <Dialog
        open={addOpen}
        className="dialog--targets-add"
        title="Add a target"
        description="Paste a Torn profile link or type a player ID."
        confirmLabel="Add target"
        confirmDisabled={reference.trim().length === 0}
        onConfirm={submitAdd}
        onClose={() => setAddOpen(false)}
      >
        <div className="targets-add-form">
          <label>
            <span>Player ID or profile link</span>
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="1234567 or https://www.torn.com/profiles.php?XID=1234567"
              autoFocus
            />
          </label>
          <label>
            <span>Note <small>Optional · {addNote.length}/280</small></span>
            <textarea value={addNote} maxLength={280} onChange={(event) => setAddNote(event.target.value)} placeholder="Why are you watching this player?" />
          </label>
          <p className="targets-add-hint"><Info size={12} /> The snapshot is read once now with your key; open the page or hit Refresh to update it.</p>
        </div>
      </Dialog>
    </div>
  );
}

/* -------------------------------------------------------------------- card === */

function TargetCard({ row, now, open, busy, disabled, chainMode = false, onToggle, onRemove, onSaveNote }: {
  row: Row;
  now: number;
  open: boolean;
  busy: boolean;
  disabled: boolean;
  chainMode?: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onSaveNote: (note: string) => void;
}) {
  const { entry, snapshot, error } = row;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.note);

  const name = snapshot?.name || entry.label || `Player ${entry.tornUserId}`;
  const bucket = statusBucket(snapshot?.status.state ?? "");
  const tone = bucketTone(bucket);
  const attackable = Boolean(snapshot?.attackable);
  const lifePct = snapshot && snapshot.lifeMaximum > 0 ? Math.round((snapshot.lifeCurrent / snapshot.lifeMaximum) * 100) : null;
  const until = snapshot?.status.until ? snapshot.status.until * 1_000 : 0;
  const remaining = until > now ? until - now : 0;
  const detailId = `tgt-detail-${entry.tornUserId}`;

  const stateLabel = snapshot?.status.state || (snapshot ? "Unknown" : "No data");
  const lastActive = snapshot?.lastActionAt ? formatRelative(now - snapshot.lastActionAt * 1_000) : (snapshot?.lastActionRelative || "unknown");

  function startEditing(): void { setDraft(entry.note); setEditing(true); }
  function commitNote(): void {
    setEditing(false);
    if (draft.trim() !== entry.note.trim()) onSaveNote(draft.trim());
  }

  return (
    <li className={`targets-card${attackable ? " targets-card--ready" : ""}`} data-tone={tone}>
      <div className="targets-card__row">
        <button type="button" className="targets-card__toggle" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
          <MemberAvatar name={name} size="small" />
          <span className="targets-card__main">
            <span className="targets-card__l1">
              <span className="targets-card__name">{name}</span>
              <span className={`targets-card__state targets-card__state--${tone}`}>
                <i />
                {chainMode && remaining > 0
                  ? formatCountdown(remaining)
                  : attackable ? "Attackable" : stateLabel}
              </span>
            </span>
            <span className="targets-card__l2">
              <span>{lastActive === "just now" ? "active now" : `active ${lastActive}`}</span>
              <i>·</i>
              <span>L{snapshot?.level || "—"}</span>
              {snapshot?.factionName && <><i>·</i><span className="targets-card__faction">{snapshot.factionName}</span></>}
              {!chainMode && remaining > 0 && <><i>·</i><span className="targets-card__timer"><Clock3 size={10} /> {formatCountdown(remaining)}</span></>}
            </span>
            {lifePct !== null && (
              <span className="targets-card__life" title={`${snapshot!.lifeCurrent.toLocaleString()} / ${snapshot!.lifeMaximum.toLocaleString()} life`}>
                <span className="targets-card__life-bar"><span style={{ width: `${Math.max(2, lifePct)}%` }} /></span>
                <span className="targets-card__life-num">{lifePct}%</span>
              </span>
            )}
          </span>
          <ChevronDown size={15} className={`targets-card__chev${open ? " targets-card__chev--open" : ""}`} />
        </button>
        {attackable && (
          <a className="targets-card__attack" href={attackUrl(entry.tornUserId)} target="_blank" rel="noreferrer" aria-label={`Attack ${name}`}>
            <Swords size={15} />
          </a>
        )}
      </div>

      {open && (
        <div id={detailId} className="targets-card__detail">
          {error && <p className="targets-card__err"><TriangleAlert size={12} /> Showing an older read — {error}</p>}
          <dl className="targets-card__facts">
            <div><dt>Status</dt><dd>{snapshot?.status.description || stateLabel}</dd></div>
            {snapshot?.factionName && <div><dt>Faction</dt><dd>{snapshot.factionName}{snapshot.position ? ` · ${snapshot.position}` : ""}</dd></div>}
            {lifePct !== null && <div><dt>Life</dt><dd>{snapshot!.lifeCurrent.toLocaleString()} / {snapshot!.lifeMaximum.toLocaleString()}</dd></div>}
            <div><dt>Torn ID</dt><dd>{entry.tornUserId}</dd></div>
            <div><dt>Added</dt><dd>{formatDate(entry.addedAt)}</dd></div>
          </dl>

          <div className="targets-card__note">
            <span className="targets-card__note-label"><Pencil size={11} /> Note</span>
            {editing ? (
              <input
                autoFocus
                className="targets-card__note-input"
                value={draft}
                maxLength={280}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commitNote}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); commitNote(); }
                  if (event.key === "Escape") { setDraft(entry.note); setEditing(false); }
                }}
              />
            ) : (
              <button type="button" className="targets-card__note-value" disabled={disabled} onClick={startEditing}>
                {entry.note || <span className="muted-value">Add a note</span>}
              </button>
            )}
          </div>

          <div className="targets-card__actions">
            <a className="button button--primary" href={attackUrl(entry.tornUserId)} target="_blank" rel="noreferrer"><Swords size={14} /> Attack</a>
            <a className="button button--secondary" href={profileUrl(entry.tornUserId)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Profile</a>
            <button type="button" className="button button--quiet" disabled={disabled} onClick={onRemove}>
              {busy ? <Spinner size={12} label="Removing" /> : <Trash2 size={13} />} Remove
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "ok" | "warn" }) {
  return (
    <article className={tone ? `targets-kpi targets-kpi--${tone}` : "targets-kpi"}>
      <small>{label}</small>
      <strong>{value}</strong>
      {sub && <p>{sub}</p>}
    </article>
  );
}

/* --------------------------------------------------------------- helpers === */

type Bucket = "attackable" | "hospital" | "jail" | "abroad" | "other";

function statusBucket(state: string): Bucket {
  if (isAttackableState(state)) return "attackable";
  const value = state.toLowerCase();
  if (value.includes("hospital")) return "hospital";
  if (value.includes("jail") || value.includes("federal")) return "jail";
  if (value.includes("travel") || value.includes("abroad")) return "abroad";
  return "other";
}

function bucketTone(bucket: Bucket): "ok" | "danger" | "warn" | "muted" {
  if (bucket === "attackable") return "ok";
  if (bucket === "hospital") return "danger";
  if (bucket === "jail") return "warn";
  return "muted";
}

function futureUntil(snapshot: TargetSnapshot | null, now: number): boolean {
  return Boolean(snapshot?.status.until && snapshot.status.until * 1_000 > now);
}

function untilMs(snapshot: TargetSnapshot | null, now: number): number {
  const until = snapshot?.status.until ? snapshot.status.until * 1_000 : 0;
  return until > now ? until - now : Number.POSITIVE_INFINITY;
}

/** Chain queue ordering: ready now, then clearing soonest. */
function chainOrder(row: Row, now: number): number {
  return row.snapshot?.attackable ? 0 : futureUntil(row.snapshot, now) ? 1 : 2;
}

function compareRows(a: Row, b: Row, sort: SortKey): number {
  const an = a.snapshot?.name || a.entry.label || `Player ${a.entry.tornUserId}`;
  const bn = b.snapshot?.name || b.entry.label || `Player ${b.entry.tornUserId}`;
  if (sort === "name") return an.localeCompare(bn);
  if (sort === "level") return (b.snapshot?.level ?? -1) - (a.snapshot?.level ?? -1) || an.localeCompare(bn);
  if (sort === "added") return Date.parse(b.entry.addedAt) - Date.parse(a.entry.addedAt);
  if (sort === "lastAction") return (b.snapshot?.lastActionAt ?? 0) - (a.snapshot?.lastActionAt ?? 0);
  // status / readiness
  return statusRank(a.snapshot?.status.state ?? "") - statusRank(b.snapshot?.status.state ?? "") || an.localeCompare(bn);
}

function statusRank(state: string): number {
  const order: Record<Bucket, number> = { attackable: 0, hospital: 1, jail: 2, abroad: 3, other: 4 };
  return order[statusBucket(state)];
}

function formatRelative(diffMs: number): string {
  const diff = Math.max(0, diffMs);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "recently"
    : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
