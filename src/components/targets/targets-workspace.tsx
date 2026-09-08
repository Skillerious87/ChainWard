"use client";

import {
  Activity,
  ChevronDown,
  Clock3,
  Crosshair,
  ExternalLink,
  Info,
  Pencil,
  Pin,
  Plane,
  Plus,
  RadioTower,
  RefreshCw,
  Search,
  ShieldCheck,
  Swords,
  Tag,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addTargetAction,
  importTargetsAction,
  refreshTargetsAction,
  removeTargetAction,
  setTargetPinnedAction,
  setTargetTagsAction,
  updateTargetNoteAction,
} from "@/app/(platform)/targets/actions";
import { ExportButton } from "@/components/ui/action-controls";
import { Dialog } from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { useWorkspaceSectionNavigation } from "@/components/shell/workspace-section-navigation";
import { notify } from "@/lib/client-actions";
import { getBrowserNotificationPermission, showWindowsNotification } from "@/lib/member-notification-preferences";
import { isAttackableState, MAX_TAGS_PER_TARGET, MAX_TARGETS, normaliseTag, type TargetEntry, type TargetSnapshot } from "@/lib/targets/types";
import type { SafeChainTelemetry } from "@/lib/torn/telemetry-types";

type SortKey = "readiness" | "lastAction" | "lastHit" | "level" | "name" | "added";
type StatusFilter = "all" | "attackable" | "hospital" | "abroad" | "other";
type View = "list" | "chain" | "abroad";
const VIEWS: readonly View[] = ["list", "chain", "abroad"];
const STALE_MS = 5 * 60_000;
const POLL_MS = 60_000;
const LIVE_KEY = "chainward:targets-live:v1";

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
  chain: SafeChainTelemetry | null;
  chainDataAgeMs: number;
  chainCheckedAt: string;
}

interface Row {
  entry: TargetEntry;
  snapshot: TargetSnapshot | null;
  error: string | null;
}

interface LiveState {
  snapshots: Record<string, TargetSnapshot>;
  errors: Record<number, string>;
  clearedErrors: number[];
  chain: SafeChainTelemetry | null;
  chainAnchorMs: number;
  syncedAt: number;
}

export function TargetsWorkspace(props: TargetsWorkspaceProps) {
  const { entries, snapshots, errors, source, fetchedAt, nowMs, connected, storageAvailable } = props;
  const router = useRouter();
  const { view: rawView } = useWorkspaceSectionNavigation("targets");
  const view: View = VIEWS.includes(rawView as View) ? (rawView as View) : "list";

  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(nowMs);
  const [addOpen, setAddOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [addNote, setAddNote] = useState("");
  const [importText, setImportText] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("readiness");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [hitYouBackOnly, setHitYouBackOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Row | null>(null);
  const [live, setLive] = useState(() => {
    try { return window.localStorage.getItem(LIVE_KEY) !== "0"; } catch { return true; }
  });
  const [liveState, setLiveState] = useState<LiveState>(() => ({
    snapshots: {}, errors: {}, clearedErrors: [], chain: null, chainAnchorMs: 0, syncedAt: 0,
  }));

  const searchRef = useRef<HTMLInputElement>(null);
  const attackableRef = useRef<Set<number>>(new Set(
    Object.values(snapshots).filter((s) => s.attackable).map((s) => s.tornUserId),
  ));

  // The ref above only seeds once at mount. A server round-trip (add/remove, a
  // manual refresh, a plain navigation) hands back a fresh `snapshots` prop
  // without re-running that initializer, so without this the *next* live poll
  // would misread an already-attackable target as having just changed state
  // and fire a spurious "attackable" notification. Resync per-id, mirroring
  // exactly how applyPoll itself mutates the ref, just triggered by the
  // server-sourced prop instead of a poll response.
  useEffect(() => {
    const known = new Set(Object.values(snapshots).map((s) => s.tornUserId));
    for (const id of attackableRef.current) {
      if (!known.has(id)) attackableRef.current.delete(id);
    }
    for (const s of Object.values(snapshots)) {
      if (s.attackable) attackableRef.current.add(s.tornUserId);
      else attackableRef.current.delete(s.tornUserId);
    }
  }, [snapshots]);

  // Second-resolution clock for countdowns; first render uses the server nowMs.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const frame = window.requestAnimationFrame(tick);
    const timer = window.setInterval(tick, 1_000);
    return () => { window.cancelAnimationFrame(frame); window.clearInterval(timer); };
  }, []);

  const applyPoll = useCallback((payload: {
    snapshots: TargetSnapshot[];
    errors: Record<string, string>;
    chain: SafeChainTelemetry | null;
    dataAgeMs: number;
    checkedAt: string;
  }) => {
    // Alert on anyone who has just become attackable (dedup via a ref).
    const freshlyUp: TargetSnapshot[] = [];
    for (const snapshot of payload.snapshots) {
      if (snapshot.attackable && !attackableRef.current.has(snapshot.tornUserId)) freshlyUp.push(snapshot);
      if (snapshot.attackable) attackableRef.current.add(snapshot.tornUserId);
      else attackableRef.current.delete(snapshot.tornUserId);
    }
    if (freshlyUp.length > 0) {
      const names = freshlyUp.map((s) => s.name || `Player ${s.tornUserId}`);
      notify({
        title: freshlyUp.length === 1 ? `${names[0]} is attackable` : `${freshlyUp.length} targets are now attackable`,
        description: names.slice(0, 3).join(", "),
        tone: "success",
      });
      if (getBrowserNotificationPermission() === "granted") {
        void showWindowsNotification(
          freshlyUp.length === 1 ? `${names[0]} is out of hospital` : `${freshlyUp.length} targets are attackable`,
          { body: names.slice(0, 4).join(", "), icon: "/icons/android-chrome-192x192.png", tag: "chainward-targets", data: { url: "/targets?section=chain" } },
        );
      }
    }

    setLiveState((prev) => {
      const nextSnapshots = { ...prev.snapshots };
      const nextErrors = { ...prev.errors };
      const cleared = new Set(prev.clearedErrors);
      for (const snapshot of payload.snapshots) {
        nextSnapshots[String(snapshot.tornUserId)] = snapshot;
        cleared.add(snapshot.tornUserId);
        delete nextErrors[snapshot.tornUserId];
      }
      for (const [id, message] of Object.entries(payload.errors)) nextErrors[Number(id)] = message;
      return {
        snapshots: nextSnapshots,
        errors: nextErrors,
        clearedErrors: [...cleared],
        chain: payload.chain,
        chainAnchorMs: Date.parse(payload.checkedAt) - payload.dataAgeMs,
        syncedAt: Date.now(),
      };
    });
  }, []);

  // Live poll: refresh stale snapshots + chain while the tab is visible.
  useEffect(() => {
    if (!live || !connected || entries.length === 0) return;
    let stopped = false;
    let lastPoll = Date.parse(fetchedAt ?? "") || Date.now();

    async function poll(): Promise<void> {
      if (stopped || !navigator.onLine || document.visibilityState !== "visible") return;
      lastPoll = Date.now();
      try {
        const response = await fetch("/api/targets/refresh", { headers: { accept: "application/json" }, cache: "no-store" });
        if (!response.ok || stopped) return;
        const payload = await response.json();
        if (payload && Array.isArray(payload.snapshots)) applyPoll(payload);
      } catch { /* keep the last good reading */ }
    }

    function resume(): void {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (Date.now() - lastPoll >= POLL_MS) void poll();
    }

    const timer = window.setInterval(() => void poll(), POLL_MS);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [live, connected, entries.length, fetchedAt, applyPoll]);

  function toggleLive(): void {
    setLive((value) => {
      const next = !value;
      try { window.localStorage.setItem(LIVE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  // Merge SSR props with live deltas, taking the freshest snapshot per target.
  const mergedSnapshots = useMemo(() => {
    const out: Record<string, TargetSnapshot> = { ...snapshots };
    for (const [id, snapshot] of Object.entries(liveState.snapshots)) {
      const base = out[id];
      if (!base || Date.parse(snapshot.fetchedAt) >= Date.parse(base.fetchedAt)) out[id] = snapshot;
    }
    return out;
  }, [snapshots, liveState.snapshots]);

  const mergedErrors = useMemo(() => {
    const out: Record<number, string> = { ...errors };
    for (const id of liveState.clearedErrors) delete out[id];
    for (const [id, message] of Object.entries(liveState.errors)) out[Number(id)] = message;
    return out;
  }, [errors, liveState.errors, liveState.clearedErrors]);

  const chain = liveState.chain ?? props.chain;
  const chainAnchorMs = liveState.chainAnchorMs || (Date.parse(props.chainCheckedAt) - props.chainDataAgeMs);
  const syncedAt = liveState.syncedAt || (Date.parse(fetchedAt ?? "") || 0);

  const rows = useMemo<Row[]>(() => entries.map((entry) => ({
    entry,
    snapshot: mergedSnapshots[String(entry.tornUserId)] ?? null,
    error: mergedErrors[entry.tornUserId] ?? null,
  })), [entries, mergedSnapshots, mergedErrors]);

  const allTags = useMemo(() => [...new Set(entries.flatMap((entry) => entry.tags))].sort(), [entries]);

  const counts = useMemo(() => {
    let attackable = 0, hospital = 0, abroad = 0, other = 0, stale = 0, pinned = 0, hitYouBack = 0;
    for (const row of rows) {
      const bucket = statusBucket(row.snapshot?.status.state ?? "");
      if (bucket === "attackable") attackable += 1;
      else if (bucket === "hospital") hospital += 1;
      else if (bucket === "abroad") abroad += 1;
      else other += 1;
      if (row.entry.pinned) pinned += 1;
      if (row.snapshot?.hitYouBack) hitYouBack += 1;
      const age = row.snapshot ? now - Date.parse(row.snapshot.fetchedAt) : Number.POSITIVE_INFINITY;
      if (!row.snapshot || !Number.isFinite(age) || age > STALE_MS) stale += 1;
    }
    return { total: rows.length, attackable, hospital, abroad, other, stale, pinned, hitYouBack };
  }, [rows, now]);

  const query = search.trim().toLowerCase();
  const matches = useCallback((row: Row) => {
    if (tagFilter.length > 0 && !tagFilter.some((tag) => row.entry.tags.includes(tag))) return false;
    if (hitYouBackOnly && !row.snapshot?.hitYouBack) return false;
    if (!query) return true;
    return `${row.snapshot?.name ?? row.entry.label} ${row.entry.tornUserId} ${row.snapshot?.factionName ?? ""} ${row.entry.note} ${row.entry.tags.join(" ")}`
      .toLowerCase().includes(query);
  }, [query, tagFilter, hitYouBackOnly]);

  const watchlistRows = useMemo(() => rows
    .filter(matches)
    .filter((row) => statusFilter === "all" || statusBucket(row.snapshot?.status.state ?? "") === statusFilter)
    .sort((a, b) => pinnedFirst(a, b) || compareRows(a, b, sort, now)),
    [rows, matches, statusFilter, sort, now]);

  const chainRows = useMemo(() => rows
    .filter(matches)
    .filter((row) => {
      const bucket = statusBucket(row.snapshot?.status.state ?? "");
      if (bucket === "attackable") return true;
      return (bucket === "hospital" || bucket === "jail") && futureUntil(row.snapshot, now);
    })
    // Readiness/timing first — this view exists to answer "who do I hit next,"
    // so a pinned target sitting in hospital must not outrank one that's
    // actually ready. Pin still breaks ties among equally-ready targets.
    .sort((a, b) => chainOrder(a, now) - chainOrder(b, now) || untilMs(a.snapshot, now) - untilMs(b.snapshot, now) || pinnedFirst(a, b)),
    [rows, matches, now]);

  const abroadRows = useMemo(() => rows
    .filter(matches)
    .filter((row) => statusBucket(row.snapshot?.status.state ?? "") === "abroad")
    .sort((a, b) => untilMs(a.snapshot, now) - untilMs(b.snapshot, now) || pinnedFirst(a, b)),
    [rows, matches, now]);

  const nextReady = chainRows.find((row) => row.snapshot?.attackable) ?? null;

  const exportRows = useMemo(() => rows.map((row) => ({
    name: row.snapshot?.name ?? row.entry.label ?? `Player ${row.entry.tornUserId}`,
    tornUserId: row.entry.tornUserId,
    status: row.snapshot?.status.description ?? "Unknown",
    state: row.snapshot?.status.state ?? "Unknown",
    lastAction: row.snapshot?.lastActionRelative ?? "Unknown",
    level: row.snapshot?.level ?? 0,
    faction: row.snapshot?.factionName ?? "",
    tags: row.entry.tags.join("|"),
    pinned: row.entry.pinned ? "yes" : "",
    lastHitByMe: row.snapshot?.lastHit ? `${row.snapshot.lastHit.result} @ ${new Date(row.snapshot.lastHit.at * 1_000).toISOString()}` : "",
    note: row.entry.note,
  })), [rows]);

  const runAction = useCallback((id: number | null, action: () => Promise<{ ok: boolean; message: string }>): void => {
    setBusyId(id);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      notify({ title: result.message, tone: result.ok ? "success" : "warning" });
      if (result.ok) router.refresh();
    });
  }, [router, startTransition]);

  async function submitAdd(): Promise<void> {
    const result = bulkMode
      ? await importTargetsAction({ text: importText })
      : await addTargetAction({ reference, note: addNote });
    notify({ title: result.message, tone: result.ok ? "success" : "warning" });
    if (!result.ok) throw new Error(result.message);
    setReference(""); setAddNote(""); setImportText("");
    router.refresh();
  }

  async function confirmRemoveTarget(): Promise<void> {
    if (!removeTarget) return;
    const result = await removeTargetAction({ tornUserId: removeTarget.entry.tornUserId });
    notify({ title: result.message, tone: result.ok ? "success" : "warning" });
    if (!result.ok) throw new Error(result.message);
    router.refresh();
  }

  // Keyboard: / focuses search, r refreshes, a opens the next attack.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); }
      else if (event.key.toLowerCase() === "r" && !pending && connected && entries.length > 0) {
        runAction(null, refreshTargetsAction);
      } else if (event.key.toLowerCase() === "a" && nextReady) {
        window.open(attackUrl(nextReady.entry.tornUserId), "_blank", "noopener");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, connected, entries.length, nextReady, runAction]);

  const canAdd = connected && storageAvailable && entries.length < MAX_TARGETS;
  // Chain/Abroad never read statusFilter (see chainRows/abroadRows above), so
  // their own "clear filters" prompt only needs to watch the filters that
  // actually narrow them.
  const hasActiveFilters = Boolean(query) || statusFilter !== "all" || tagFilter.length > 0 || hitYouBackOnly;
  const hasActiveNarrowingFilters = Boolean(query) || tagFilter.length > 0 || hitYouBackOnly;
  function clearFilters(): void {
    setSearch("");
    setStatusFilter("all");
    setTagFilter([]);
    setHitYouBackOnly(false);
  }

  const cardProps = (row: Row) => ({
    row,
    now,
    open: expandedId === row.entry.tornUserId,
    busy: busyId === row.entry.tornUserId && pending,
    disabled: pending,
    onToggle: () => setExpandedId((current) => (current === row.entry.tornUserId ? null : row.entry.tornUserId)),
    onRemove: () => setRemoveTarget(row),
    onPin: () => runAction(row.entry.tornUserId, () => setTargetPinnedAction({ tornUserId: row.entry.tornUserId, pinned: !row.entry.pinned })),
    onSaveNote: (note: string) => runAction(row.entry.tornUserId, () => updateTargetNoteAction({ tornUserId: row.entry.tornUserId, note })),
    onSaveTags: (tags: string[]) => runAction(row.entry.tornUserId, () => setTargetTagsAction({ tornUserId: row.entry.tornUserId, tags })),
  });

  return (
    <div className="page-stack targets-workspace">
      <PageHeader
        eyebrow="Personal watchlist"
        title="Targets"
        description="Track Torn players for chaining — status, hospital timers, last hit, and health, refreshed from your own key."
        actions={<>
          <button
            type="button"
            className={`button ${live ? "button--secondary" : "button--quiet"} targets-livebtn`}
            aria-pressed={live}
            onClick={toggleLive}
            title={live ? "Live updates on — click to pause" : "Live updates paused"}
          >
            <RadioTower size={15} className={live ? "targets-livebtn__on" : undefined} /> {live ? "Live" : "Paused"}
          </button>
          <button
            className="button button--secondary"
            disabled={pending || !connected || entries.length === 0}
            onClick={() => runAction(null, refreshTargetsAction)}
          >
            {busyId === null && pending ? <Spinner size={15} label="Refreshing targets" tone="muted" /> : <RefreshCw size={15} />}
            {busyId === null && pending ? "Refreshing…" : "Refresh"}
          </button>
          <ExportButton filename="chainward-targets.csv" label="Export" rows={exportRows} />
          <button className="button button--primary" disabled={!canAdd} onClick={() => { setBulkMode(false); setAddOpen(true); }}>
            <Plus size={15} /> Add target
          </button>
        </>}
      />

      {connected && chain && <ChainStrip chain={chain} anchorMs={chainAnchorMs} now={now} />}

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
            <p>Add a Torn player by ID or profile link — or paste a whole list. Chainward keeps a live snapshot of status and hospital timers.</p>
            <div className="targets-empty__actions">
              <button className="button button--primary" onClick={() => { setBulkMode(false); setAddOpen(true); }}><Plus size={15} /> Add a target</button>
              <button className="button button--secondary" onClick={() => { setBulkMode(true); setAddOpen(true); }}><Tag size={15} /> Paste a list</button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* Search and tag filtering apply to all three tabs below (see
              `matches`), so the controls live here once instead of being
              reachable only from whichever tab happens to render them. */}
          <div className="panel targets-tools targets-tools--shared">
            <label className="search-field">
              <Search size={15} /><span className="sr-only">Search targets</span>
              <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, ID, faction, tag, note" />
            </label>
            {allTags.length > 0 && (
              <div className="targets-tagfilter" role="group" aria-label="Filter by tag">
                <Tag size={12} />
                {allTags.map((tag) => (
                  <button
                    type="button"
                    key={tag}
                    aria-pressed={tagFilter.includes(tag)}
                    className={tagFilter.includes(tag) ? "targets-tagchip targets-tagchip--active" : "targets-tagchip"}
                    onClick={() => setTagFilter((current) => current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag])}
                  >
                    {tag}
                  </button>
                ))}
                {tagFilter.length > 0 && <button type="button" className="targets-tagclear" onClick={() => setTagFilter([])}>Clear</button>}
              </div>
            )}
          </div>

          {/* ------------------------------------------------------- Watchlist */}
          <section id="targets-panel-list" role="tabpanel" aria-labelledby="targets-tab-list" hidden={view !== "list"}>
            <section className="targets-kpis" aria-label="Target list summary">
              <Kpi label="Targets" value={counts.total} sub={`${MAX_TARGETS - counts.total} free · ${counts.pinned} pinned`} />
              <Kpi label="Attackable" value={counts.attackable} tone={counts.attackable ? "ok" : undefined} sub="Status is Okay" />
              <Kpi label="In hospital" value={counts.hospital} tone={counts.hospital ? "warn" : undefined} sub="Waiting to clear" />
              <Kpi label="Abroad" value={counts.abroad} sub="Travelling or overseas" />
              <Kpi label="Hit you back" value={counts.hitYouBack} tone={counts.hitYouBack ? "warn" : undefined} sub="Since your last hit" />
            </section>

            <section className="panel targets-panel">
              <div className="section-heading">
                <div><h2>Watchlist</h2><p>{watchlistRows.length} of {rows.length} shown</p></div>
                <span className="analytics-panel-icon"><Crosshair size={17} /></span>
              </div>
              <div className="targets-panel__body">
                <div className="targets-tools">
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
                    <button type="button" aria-pressed={hitYouBackOnly} className={hitYouBackOnly ? "targets-chip targets-chip--active" : "targets-chip"} onClick={() => setHitYouBackOnly((current) => !current)}>
                      Hit you back<span>{counts.hitYouBack}</span>
                    </button>
                  </div>
                  <label className="targets-sortselect">
                    <span className="sr-only">Sort targets</span>
                    <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                      <option value="readiness">Sort: readiness</option>
                      <option value="lastHit">Sort: least recently hit</option>
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
                {watchlistRows.length === 0 && (
                  <div className="targets-blank">
                    <p>No targets match this view.</p>
                    {hasActiveFilters && <button type="button" className="button button--quiet" onClick={clearFilters}>Clear filters</button>}
                  </div>
                )}
              </div>
            </section>
          </section>

          {/* ----------------------------------------------------- Chain queue */}
          <section id="targets-panel-chain" role="tabpanel" aria-labelledby="targets-tab-chain" hidden={view !== "chain"}>
            <section className="panel targets-panel">
              <div className="section-heading">
                <div><h2>Chain queue</h2><p>{counts.attackable} ready now · {Math.max(0, chainRows.length - counts.attackable)} clearing soon</p></div>
                {nextReady && (
                  <a className="button button--primary targets-next" href={attackUrl(nextReady.entry.tornUserId)} target="_blank" rel="noreferrer">
                    <Swords size={14} /> Attack next
                  </a>
                )}
              </div>
              <div className="targets-panel__body">
                <p className="targets-hint"><Info size={13} /> Attackable first, then anyone in hospital or jail ordered by who clears soonest. Countdowns are live{live ? " and auto-refreshing" : ""}.</p>
                <ul className="targets-list">
                  {chainRows.map((row) => <TargetCard key={row.entry.tornUserId} {...cardProps(row)} chainMode />)}
                </ul>
                {chainRows.length === 0 && (
                  <div className="targets-blank">
                    <p>Nobody on your list is attackable or clearing soon.</p>
                    {hasActiveNarrowingFilters && <button type="button" className="button button--quiet" onClick={clearFilters}>Clear filters</button>}
                  </div>
                )}
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
                {abroadRows.length === 0 && (
                  <div className="targets-blank">
                    <p>No targets are abroad right now.</p>
                    {hasActiveNarrowingFilters && <button type="button" className="button button--quiet" onClick={clearFilters}>Clear filters</button>}
                  </div>
                )}
              </div>
            </section>
          </section>

          <footer className="targets-provenance">
            <ShieldCheck size={14} />
            <p>
              <strong>Read with your key.</strong>{" "}
              <span>
                {live ? "Live — " : "Paused — "}
                {syncedAt ? `updated ${formatAgo(now - syncedAt)} from ${source}. ` : `synced from ${source}. `}
                {live ? "Refreshes stale targets every minute while this tab is open." : "Turn Live on to auto-refresh."}
                {counts.stale > 0 ? ` ${counts.stale} shown from an older read.` : ""}
              </span>
            </p>
          </footer>
        </>
      )}

      <Dialog
        open={addOpen}
        className="dialog--targets-add"
        title={bulkMode ? "Import a list of targets" : "Add a target"}
        description={bulkMode ? "Paste Torn player IDs or profile links — one per line, or comma-separated." : "Paste a Torn profile link or type a player ID."}
        confirmLabel={bulkMode ? "Import" : "Add target"}
        confirmDisabled={bulkMode ? importText.trim().length === 0 : reference.trim().length === 0}
        onConfirm={submitAdd}
        onClose={() => setAddOpen(false)}
      >
        <div className="targets-add-form">
          <div className="targets-add-mode" role="group" aria-label="Add mode">
            <button type="button" aria-pressed={!bulkMode} className={!bulkMode ? "targets-add-mode--active" : undefined} onClick={() => setBulkMode(false)}>One target</button>
            <button type="button" aria-pressed={bulkMode} className={bulkMode ? "targets-add-mode--active" : undefined} onClick={() => setBulkMode(true)}>Paste a list</button>
          </div>
          {bulkMode ? (
            <label>
              <span>Player IDs or profile links <small>up to the {MAX_TARGETS}-target cap</small></span>
              <textarea value={importText} maxLength={4_000} onChange={(event) => setImportText(event.target.value)} placeholder={"1234567\n2345678\nhttps://www.torn.com/profiles.php?XID=3456789"} rows={6} />
            </label>
          ) : (
            <>
              <label>
                <span>Player ID or profile link</span>
                <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="1234567 or https://www.torn.com/profiles.php?XID=1234567" autoFocus />
              </label>
              <label>
                <span>Note <small>Optional · {addNote.length}/280</small></span>
                <textarea value={addNote} maxLength={280} onChange={(event) => setAddNote(event.target.value)} placeholder="Why are you watching this player?" />
              </label>
            </>
          )}
          <p className="targets-add-hint"><Info size={12} /> Snapshots are read once now with your key; Live keeps them current after that.</p>
        </div>
      </Dialog>

      <Dialog
        open={removeTarget !== null}
        className="dialog--targets-remove"
        title={removeTarget ? `Remove ${removeTarget.snapshot?.name || removeTarget.entry.label || `player ${removeTarget.entry.tornUserId}`}?` : "Remove target?"}
        description="Their note, tags, and pin are discarded. You can add them back later, but this doesn't restore what's removed."
        confirmLabel="Remove target"
        destructive
        onConfirm={confirmRemoveTarget}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}

/* ----------------------------------------------------------------- chain === */

function ChainStrip({ chain, anchorMs, now }: { chain: SafeChainTelemetry; anchorMs: number; now: number }) {
  const active = chain.state === "active" && chain.current > 0;
  const timeoutRemaining = active ? Math.max(0, chain.timeoutSeconds * 1_000 - (now - anchorMs)) : 0;
  const cooldownRemaining = chain.state === "cooldown" ? Math.max(0, chain.cooldownSeconds * 1_000 - (now - anchorMs)) : 0;
  const tone = !active ? "idle" : timeoutRemaining <= 60_000 ? "danger" : timeoutRemaining <= 180_000 ? "warn" : "ok";

  return (
    <section className={`targets-chainbar targets-chainbar--${tone}`} aria-label="Faction chain status">
      <span className="targets-chainbar__icon"><Activity size={16} /></span>
      {active ? (
        <>
          <span className="targets-chainbar__count"><strong>{chain.current.toLocaleString()}</strong> hits</span>
          {chain.modifier > 1 && <span className="targets-chainbar__mod">×{chain.modifier.toFixed(2)}</span>}
          <span className="targets-chainbar__timer"><Clock3 size={13} /> {formatCountdown(timeoutRemaining)} to timeout</span>
        </>
      ) : chain.state === "cooldown" ? (
        <span className="targets-chainbar__count">Chain cooldown · {formatCountdown(cooldownRemaining)} left</span>
      ) : (
        <span className="targets-chainbar__count">No chain running</span>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------- card === */

function TargetCard({ row, now, open, busy, disabled, chainMode = false, onToggle, onRemove, onPin, onSaveNote, onSaveTags }: {
  row: Row;
  now: number;
  open: boolean;
  busy: boolean;
  disabled: boolean;
  chainMode?: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onPin: () => void;
  onSaveNote: (note: string) => void;
  onSaveTags: (tags: string[]) => void;
}) {
  const { entry, snapshot, error } = row;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.note);
  const [tagDraft, setTagDraft] = useState("");

  const name = snapshot?.name || entry.label || `Player ${entry.tornUserId}`;
  const bucket = statusBucket(snapshot?.status.state ?? "");
  const tone = bucketTone(bucket);
  const attackable = Boolean(snapshot?.attackable);
  const lifePct = snapshot && snapshot.lifeMaximum > 0 ? Math.round((snapshot.lifeCurrent / snapshot.lifeMaximum) * 100) : null;
  const until = snapshot?.status.until ? snapshot.status.until * 1_000 : 0;
  const remaining = until > now ? until - now : 0;
  const detailId = `tgt-detail-${entry.tornUserId}`;
  const stateLabel = snapshot?.status.state || (snapshot ? "Unknown" : "No data");
  const lastActive = snapshot?.lastActionAt ? formatAgo(now - snapshot.lastActionAt * 1_000) : (snapshot?.lastActionRelative || "unknown");
  const onlineDot = (snapshot?.lastActionStatus || "").toLowerCase();

  function startEditing(): void { setDraft(entry.note); setEditing(true); }
  function commitNote(): void {
    setEditing(false);
    if (draft.trim() !== entry.note.trim()) onSaveNote(draft.trim());
  }
  function addTag(): void {
    const tag = normaliseTag(tagDraft);
    setTagDraft("");
    if (tag && !entry.tags.includes(tag) && entry.tags.length < MAX_TAGS_PER_TARGET) onSaveTags([...entry.tags, tag]);
  }

  return (
    <li className={`targets-card${attackable ? " targets-card--ready" : ""}${entry.pinned ? " targets-card--pinned" : ""}`} data-tone={tone}>
      <div className="targets-card__row">
        <button type="button" className="targets-card__toggle" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
          <span className="targets-card__ava">
            <MemberAvatar name={name} size="small" />
            {onlineDot && <i className={`targets-card__dot targets-card__dot--${onlineDot.includes("online") ? "online" : onlineDot.includes("idle") ? "idle" : "offline"}`} />}
          </span>
          <span className="targets-card__main">
            <span className="targets-card__l1">
              <span className="targets-card__name">{entry.pinned && <Pin size={11} className="targets-card__pinmark" />}{name}</span>
              <span className={`targets-card__state targets-card__state--${tone}`}>
                <i />
                {chainMode && remaining > 0 ? formatCountdown(remaining) : attackable ? "Attackable" : stateLabel}
              </span>
            </span>
            <span className="targets-card__l2">
              <span>{lastActive === "just now" ? "active now" : `active ${lastActive}`}</span>
              <i>·</i>
              <span>L{snapshot?.level || "—"}</span>
              {snapshot?.factionName && <><i>·</i><span className="targets-card__faction">{snapshot.factionName}</span></>}
              {!chainMode && remaining > 0 && <><i>·</i><span className="targets-card__timer"><Clock3 size={10} /> {formatCountdown(remaining)}</span></>}
            </span>
            {(snapshot?.lastHit || snapshot?.hitYouBack || entry.tags.length > 0) && (
              <span className="targets-card__l3">
                {snapshot?.lastHit && (
                  <span className="targets-card__hit" title={`You: ${snapshot.lastHit.result}, ${new Date(snapshot.lastHit.at * 1_000).toLocaleString()}`}>
                    <Swords size={9} /> {snapshot.lastHit.result || "hit"} {formatAgo(now - snapshot.lastHit.at * 1_000)}
                    {snapshot.lastHit.respect > 0 && ` · +${snapshot.lastHit.respect.toFixed(1)}`}
                  </span>
                )}
                {snapshot?.hitYouBack && <span className="targets-card__retal" title="This target has attacked you since your last hit"><TriangleAlert size={9} /> hit back</span>}
                {entry.tags.map((tag) => <span key={tag} className="targets-card__tag">{tag}</span>)}
              </span>
            )}
            {lifePct !== null && (
              <span className="targets-card__life" title={`${snapshot!.lifeCurrent.toLocaleString()} / ${snapshot!.lifeMaximum.toLocaleString()} life`}>
                <span className="targets-card__life-bar"><span style={{ width: `${Math.max(2, lifePct)}%` }} /></span>
                <span className="targets-card__life-num">{lifePct}%</span>
              </span>
            )}
          </span>
          <ChevronDown size={15} className={`targets-card__chev${open ? " targets-card__chev--open" : ""}`} />
        </button>
        <button type="button" className={`targets-card__pin${entry.pinned ? " targets-card__pin--on" : ""}`} disabled={disabled} onClick={onPin} aria-label={entry.pinned ? `Unpin ${name}` : `Pin ${name}`} aria-pressed={entry.pinned}>
          <Pin size={14} />
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
            {snapshot?.lastHit && <div><dt>Your last hit</dt><dd>{snapshot.lastHit.result || "Hit"} · {formatAgo(now - snapshot.lastHit.at * 1_000)}{snapshot.lastHit.respect > 0 ? ` · +${snapshot.lastHit.respect.toFixed(2)}` : ""}</dd></div>}
            <div><dt>Torn ID</dt><dd>{entry.tornUserId}</dd></div>
            <div><dt>Added</dt><dd>{formatDate(entry.addedAt)}</dd></div>
          </dl>

          <div className="targets-card__tags-edit">
            <span className="targets-card__note-label"><Tag size={11} /> Tags <small>{entry.tags.length}/{MAX_TAGS_PER_TARGET}</small></span>
            <span className="targets-card__tags-row">
              {entry.tags.map((tag) => (
                <span key={tag} className="targets-card__tag targets-card__tag--edit">
                  {tag}
                  <button type="button" disabled={disabled} onClick={() => onSaveTags(entry.tags.filter((t) => t !== tag))} aria-label={`Remove tag ${tag}`}><X size={10} /></button>
                </span>
              ))}
              {entry.tags.length < MAX_TAGS_PER_TARGET && (
                <input
                  className="targets-card__tag-input"
                  value={tagDraft}
                  maxLength={24}
                  placeholder="add tag"
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }}
                  onBlur={addTag}
                />
              )}
            </span>
          </div>

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
            <button type="button" className="button button--quiet" disabled={disabled} onClick={onPin}><Pin size={13} /> {entry.pinned ? "Unpin" : "Pin"}</button>
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

function chainOrder(row: Row, now: number): number {
  return row.snapshot?.attackable ? 0 : futureUntil(row.snapshot, now) ? 1 : 2;
}

function pinnedFirst(a: Row, b: Row): number {
  return Number(b.entry.pinned) - Number(a.entry.pinned);
}

function compareRows(a: Row, b: Row, sort: SortKey, now: number): number {
  const an = a.snapshot?.name || a.entry.label || `Player ${a.entry.tornUserId}`;
  const bn = b.snapshot?.name || b.entry.label || `Player ${b.entry.tornUserId}`;
  if (sort === "name") return an.localeCompare(bn);
  if (sort === "level") return (b.snapshot?.level ?? -1) - (a.snapshot?.level ?? -1) || an.localeCompare(bn);
  if (sort === "added") return Date.parse(b.entry.addedAt) - Date.parse(a.entry.addedAt);
  if (sort === "lastAction") return (b.snapshot?.lastActionAt ?? 0) - (a.snapshot?.lastActionAt ?? 0);
  if (sort === "lastHit") {
    // Never-hit first, then oldest hit first — spread the chain around.
    const at = a.snapshot?.lastHit?.at ?? 0;
    const bt = b.snapshot?.lastHit?.at ?? 0;
    return at - bt || an.localeCompare(bn);
  }
  // readiness
  return statusRank(a.snapshot?.status.state ?? "", a.snapshot, now) - statusRank(b.snapshot?.status.state ?? "", b.snapshot, now) || an.localeCompare(bn);
}

function statusRank(state: string, snapshot: TargetSnapshot | null, now: number): number {
  const bucket = statusBucket(state);
  const base: Record<Bucket, number> = { attackable: 0, hospital: 1_000, jail: 2_000, abroad: 3_000, other: 4_000 };
  // Within hospital/jail, sooner-to-clear ranks higher.
  const clearing = (bucket === "hospital" || bucket === "jail") ? Math.min(999, Math.floor(untilMs(snapshot, now) / 60_000)) : 0;
  return base[bucket] + clearing;
}

function formatAgo(diffMs: number): string {
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

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
