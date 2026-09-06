"use client";

import {
  Crosshair,
  ExternalLink,
  Heart,
  Info,
  ListFilter,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Swords,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addTargetAction,
  refreshTargetsAction,
  removeTargetAction,
  updateTargetNoteAction,
} from "@/app/(platform)/targets/actions";
import { ExportButton } from "@/components/ui/action-controls";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { TornUserLink } from "@/components/ui/torn-user-link";
import { notify } from "@/lib/client-actions";
import { isAttackableState, MAX_TARGETS, type TargetEntry, type TargetSnapshot } from "@/lib/targets/types";

type SortKey = "lastAction" | "status" | "level" | "name" | "added";
const STALE_MS = 5 * 60_000;

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
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(nowMs);
  const [addOpen, setAddOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [addNote, setAddNote] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("lastAction");
  const [attackableOnly, setAttackableOnly] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Tick relative labels forward after mount. The first render uses the server
  // `nowMs` so the hydrated HTML matches exactly; a frame later we correct to the
  // real clock, then keep it moving.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const frame = window.requestAnimationFrame(tick);
    const timer = window.setInterval(tick, 20_000);
    return () => { window.cancelAnimationFrame(frame); window.clearInterval(timer); };
  }, []);

  const rows = useMemo<Row[]>(() => entries.map((entry) => ({
    entry,
    snapshot: snapshots[String(entry.tornUserId)] ?? null,
    error: errors[entry.tornUserId] ?? null,
  })), [entries, snapshots, errors]);

  const summary = useMemo(() => {
    let attackable = 0, hospital = 0, travelling = 0, stale = 0;
    for (const row of rows) {
      const state = row.snapshot?.status.state.toLowerCase() ?? "";
      if (row.snapshot?.attackable) attackable += 1;
      if (state.includes("hospital")) hospital += 1;
      if (state.includes("travel") || state.includes("abroad")) travelling += 1;
      const age = row.snapshot ? now - Date.parse(row.snapshot.fetchedAt) : Number.POSITIVE_INFINITY;
      if (!row.snapshot || !Number.isFinite(age) || age > STALE_MS) stale += 1;
    }
    return { total: rows.length, attackable, hospital, travelling, stale };
  }, [rows, now]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (attackableOnly && !row.snapshot?.attackable) return false;
        if (!query) return true;
        const haystack = `${row.snapshot?.name ?? row.entry.label} ${row.entry.tornUserId} ${row.snapshot?.factionName ?? ""} ${row.entry.note}`.toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => compareRows(a, b, sort));
  }, [rows, search, attackableOnly, sort]);

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

  return (
    <div className="page-stack targets-workspace">
      <PageHeader
        eyebrow="Personal watchlist"
        title="Targets"
        description="Track Torn players you want eyes on — their status, last activity, level, and faction, refreshed from your own key."
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
      ) : (
        <>
          <section className="targets-kpis" aria-label="Target list summary">
            <Kpi label="Targets" value={summary.total} sub={`${MAX_TARGETS - summary.total} slots left`} />
            <Kpi label="Attackable now" value={summary.attackable} tone={summary.attackable ? "ok" : undefined} sub="Status is Okay" />
            <Kpi label="In hospital" value={summary.hospital} tone={summary.hospital ? "warn" : undefined} sub="Not attackable" />
            <Kpi label="Travelling" value={summary.travelling} sub="Abroad or in transit" />
            <Kpi label="Stale data" value={summary.stale} tone={summary.stale ? "warn" : undefined} sub="Older than 5 min" />
          </section>

          {entries.length === 0 ? (
            <section className="panel targets-empty">
              <span><Swords size={22} /></span>
              <div>
                <strong>No targets yet</strong>
                <p>Add a Torn player by ID or profile link. Chainward keeps a live snapshot of their status and activity.</p>
                <button className="button button--primary" onClick={() => setAddOpen(true)}><Plus size={15} /> Add your first target</button>
              </div>
            </section>
          ) : (
            <section className="panel targets-panel">
              <div className="section-heading">
                <div><h2>Watchlist</h2><p>{visibleRows.length} of {rows.length} shown</p></div>
                <span className="analytics-panel-icon"><Crosshair size={17} /></span>
              </div>
              <div className="targets-panel__body">
                <div className="targets-tools">
                  <label className="search-field">
                    <Search size={15} /><span className="sr-only">Search targets</span>
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, ID, faction, note" />
                  </label>
                  <div className="targets-sort" role="group" aria-label="Sort targets">
                    <span>Sort</span>
                    {([["lastAction", "Last action"], ["status", "Status"], ["level", "Level"], ["name", "Name"], ["added", "Added"]] as const).map(([key, label]) => (
                      <button type="button" key={key} aria-pressed={sort === key} className={sort === key ? "targets-sort--active" : undefined} onClick={() => setSort(key)}>{label}</button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={`targets-filter${attackableOnly ? " targets-filter--active" : ""}`}
                    aria-pressed={attackableOnly}
                    onClick={() => setAttackableOnly((value) => !value)}
                  >
                    <ListFilter size={13} /> Attackable only
                  </button>
                </div>

                <div className="table-scroll targets-table-scroll" role="region" aria-label="Target watchlist" tabIndex={0}>
                  <table className="data-table targets-table">
                    <thead>
                      <tr><th>Target</th><th>Status</th><th>Last action</th><th className="targets-num">Level</th><th>Life</th><th>Note</th><th><span className="sr-only">Actions</span></th></tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => (
                        <TargetRow
                          key={row.entry.tornUserId}
                          row={row}
                          now={now}
                          busy={busyId === row.entry.tornUserId && pending}
                          disabled={pending}
                          onRemove={() => runAction(row.entry.tornUserId, () => removeTargetAction({ tornUserId: row.entry.tornUserId }))}
                          onSaveNote={(note) => runAction(row.entry.tornUserId, () => updateTargetNoteAction({ tornUserId: row.entry.tornUserId, note }))}
                        />
                      ))}
                    </tbody>
                  </table>
                  {visibleRows.length === 0 && <div className="table-empty">No targets match this view.</div>}
                </div>
              </div>
            </section>
          )}

          <footer className="targets-provenance">
            <ShieldCheck size={14} />
            <p>
              <strong>Read with your key.</strong>{" "}
              <span>
                {fetchedAt ? `Synced ${formatClock(fetchedAt)} from ${source}. ` : ""}
                Snapshots older than 90 seconds refresh automatically when you open this page.
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

/* ------------------------------------------------------------------- row === */

function TargetRow({ row, now, busy, disabled, onRemove, onSaveNote }: {
  row: Row;
  now: number;
  busy: boolean;
  disabled: boolean;
  onRemove: () => void;
  onSaveNote: (note: string) => void;
}) {
  const { entry, snapshot, error } = row;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.note);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function startEditing(): void {
    setDraft(entry.note);
    setEditing(true);
  }

  const name = snapshot?.name || entry.label || `Player ${entry.tornUserId}`;
  const tone = statusTone(snapshot?.status.state ?? "");
  const lifePct = snapshot && snapshot.lifeMaximum > 0 ? Math.round((snapshot.lifeCurrent / snapshot.lifeMaximum) * 100) : null;

  function commitNote(): void {
    setEditing(false);
    if (draft.trim() !== entry.note.trim()) onSaveNote(draft.trim());
  }

  return (
    <tr className={snapshot?.attackable ? "targets-row targets-row--attackable" : "targets-row"}>
      <td data-label="Target">
        <TornUserLink
          name={name}
          tornUserId={entry.tornUserId}
          detail={snapshot?.factionName ? `${snapshot.factionName}${snapshot.position ? ` · ${snapshot.position}` : ""}` : `ID ${entry.tornUserId}`}
        />
        {error && <span className="targets-rowerror" title={error}><TriangleAlert size={11} /> Stale — {error}</span>}
      </td>
      <td data-label="Status">
        <span className={`targets-status targets-status--${tone}`}>
          <i />{snapshot?.status.description || snapshot?.status.state || "Unknown"}
        </span>
        {snapshot?.status.until && snapshot.status.until * 1_000 > now && (
          <small className="targets-until">{formatCountdown(snapshot.status.until * 1_000 - now)} left</small>
        )}
      </td>
      <td data-label="Last action">
        {snapshot?.lastActionAt
          ? <time dateTime={new Date(snapshot.lastActionAt * 1_000).toISOString()} title={new Date(snapshot.lastActionAt * 1_000).toLocaleString()}>{formatRelative(now - snapshot.lastActionAt * 1_000)}</time>
          : <span className="muted-value">{snapshot?.lastActionRelative || "Unknown"}</span>}
      </td>
      <td data-label="Level" className="targets-num">{snapshot?.level || "—"}</td>
      <td data-label="Life">
        {lifePct === null ? <span className="muted-value">—</span> : (
          <span className="targets-life" title={`${snapshot!.lifeCurrent.toLocaleString()} / ${snapshot!.lifeMaximum.toLocaleString()}`}>
            <span className="targets-life__bar" aria-hidden><span style={{ width: `${Math.max(2, lifePct)}%` }} /></span>
            <span className="targets-life__value"><Heart size={10} /> {lifePct}%</span>
          </span>
        )}
      </td>
      <td data-label="Note">
        {editing ? (
          <input
            ref={inputRef}
            className="targets-note-input"
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
          <button type="button" className="targets-note" disabled={disabled} onClick={startEditing}>
            {entry.note ? <span>{entry.note}</span> : <span className="muted-value">Add a note</span>}
            <Pencil size={11} />
          </button>
        )}
      </td>
      <td data-label="Actions">
        <div className="targets-row-actions">
          <a className="icon-button" href={`https://www.torn.com/profiles.php?XID=${entry.tornUserId}`} target="_blank" rel="noreferrer" aria-label={`Open ${name} on Torn`}>
            <ExternalLink size={14} />
          </a>
          <button type="button" className="icon-button" disabled={disabled} onClick={onRemove} aria-label={`Remove ${name}`}>
            {busy ? <Spinner size={12} label="Removing" /> : <Trash2 size={14} />}
          </button>
        </div>
      </td>
    </tr>
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

function compareRows(a: Row, b: Row, sort: SortKey): number {
  const an = a.snapshot?.name || a.entry.label || `Player ${a.entry.tornUserId}`;
  const bn = b.snapshot?.name || b.entry.label || `Player ${b.entry.tornUserId}`;
  if (sort === "name") return an.localeCompare(bn);
  if (sort === "level") return (b.snapshot?.level ?? -1) - (a.snapshot?.level ?? -1) || an.localeCompare(bn);
  if (sort === "added") return Date.parse(b.entry.addedAt) - Date.parse(a.entry.addedAt);
  if (sort === "status") return statusRank(a.snapshot?.status.state ?? "") - statusRank(b.snapshot?.status.state ?? "") || an.localeCompare(bn);
  // lastAction: most recently active first
  return (b.snapshot?.lastActionAt ?? 0) - (a.snapshot?.lastActionAt ?? 0);
}

/** Attackable targets sort ahead of everything else. */
function statusRank(state: string): number {
  if (isAttackableState(state)) return 0;
  const value = state.toLowerCase();
  if (value.includes("hospital")) return 1;
  if (value.includes("jail") || value.includes("federal")) return 2;
  if (value.includes("travel") || value.includes("abroad")) return 3;
  return 4;
}

function statusTone(state: string): "ok" | "danger" | "warn" | "muted" {
  if (isAttackableState(state)) return "ok";
  const value = state.toLowerCase();
  if (value.includes("hospital")) return "danger";
  if (value.includes("jail") || value.includes("federal")) return "warn";
  return "muted";
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
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "recently"
    : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
