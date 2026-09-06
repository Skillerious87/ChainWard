"use client";

import { CheckCircle2, ChevronDown, CircleSlash, Gauge, Lock, RefreshCw, ShieldCheck, Trash2, TriangleAlert, UploadCloud, UsersRound } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  autoShareOwnBattleStatsAction,
  refreshOwnBattleStatsAction,
  removeMemberBattleStatsAction,
  setBattleStatsAutoShareAction,
  shareOwnBattleStatsAction,
  withdrawOwnBattleStatsAction,
} from "@/app/(platform)/members/actions";
import { Spinner } from "@/components/ui/spinner";
import { TornUserLink } from "@/components/ui/torn-user-link";
import { notify } from "@/lib/client-actions";
import { isBattleStatsFresh, STATS_FRESH_MS, type MemberBattleStats } from "@/lib/members/member-battle-stats";
import type { TornRosterMember } from "@/lib/torn/workspace-types";

type StatKey = "total" | "strength" | "defense" | "speed" | "dexterity";
type SortKey = StatKey | "name" | "level";
type Feedback = { tone: "ok" | "warn"; text: string } | null;

interface MemberBattleStatsPanelProps {
  records: MemberBattleStats[];
  databaseAvailable: boolean;
  message: string;
  canManage: boolean;
  roster: TornRosterMember[];
  currentUser: { tornUserId: number; name: string };
  own: MemberBattleStats | null;
  autoShare: { enabled: boolean; due: boolean };
  nowMs: number;
}

export function MemberBattleStatsPanel({
  records,
  databaseAvailable,
  message,
  canManage,
  roster,
  currentUser,
  own,
  autoShare,
  nowMs,
}: MemberBattleStatsPanelProps) {
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const autoAttempted = useRef(false);
  const isBusy = (key: string) => busyKey === key;

  function run(key: string, action: () => Promise<{ ok: boolean; message: string }>): void {
    setBusyKey(key);
    startTransition(async () => {
      const result = await action();
      setBusyKey(null);
      setFeedback({ tone: result.ok ? "ok" : "warn", text: result.message });
      notify({ title: result.message, tone: result.ok ? "success" : "warning" });
    });
  }

  // Auto-share: fire once when the member opted in and the last snapshot is stale.
  useEffect(() => {
    if (!autoShare.enabled || !autoShare.due || autoAttempted.current) return;
    autoAttempted.current = true;
    startTransition(async () => {
      const result = await autoShareOwnBattleStatsAction();
      if (result.ok) setFeedback({ tone: "ok", text: result.message });
    });
  }, [autoShare.enabled, autoShare.due]);

  const ownFresh = isBattleStatsFresh(own?.statsAt ?? null, nowMs);

  return (
    <div className="mbs-stack">
      <SelfCard
        name={currentUser.name}
        tornUserId={currentUser.tornUserId}
        own={own}
        ownFresh={ownFresh}
        nowMs={nowMs}
        pending={pending}
        isBusy={isBusy}
        feedback={feedback}
        autoShareOn={autoShare.enabled}
        databaseAvailable={databaseAvailable}
        onShare={() => run("share", shareOwnBattleStatsAction)}
        onRefresh={() => run("refresh", refreshOwnBattleStatsAction)}
        onWithdraw={() => run("withdraw", withdrawOwnBattleStatsAction)}
        onSetAutoShare={(enabled) => run("auto", () => setBattleStatsAutoShareAction({ enabled }))}
      />

      {canManage ? (
        <LeadershipRoster
          records={records}
          roster={roster}
          message={message}
          databaseAvailable={databaseAvailable}
          nowMs={nowMs}
          pending={pending}
          isBusy={isBusy}
          onRemove={(tornUserId) => run(`remove:${tornUserId}`, () => removeMemberBattleStatsAction({ tornUserId }))}
        />
      ) : (
        <p className="mbs-inline-note">
          <ShieldCheck size={13} />
          <span>{records.length} member{records.length === 1 ? "" : "s"} sharing battle stats. Only Administrators and the faction owner see the roster.</span>
        </p>
      )}

      <footer className="mbs-provenance">
        <ShieldCheck size={14} />
        <p><strong>Source-labelled.</strong> <span>Each snapshot is read from that member&apos;s own Torn key when they share. Members withdraw at any time; leadership can also remove a stale record.</span></p>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ self card */

function SelfCard({
  name, tornUserId, own, ownFresh, nowMs, pending, isBusy, feedback, autoShareOn, databaseAvailable,
  onShare, onRefresh, onWithdraw, onSetAutoShare,
}: {
  name: string;
  tornUserId: number;
  own: MemberBattleStats | null;
  ownFresh: boolean;
  nowMs: number;
  pending: boolean;
  isBusy: (key: string) => boolean;
  feedback: Feedback;
  autoShareOn: boolean;
  databaseAvailable: boolean;
  onShare: () => void;
  onRefresh: () => void;
  onWithdraw: () => void;
  onSetAutoShare: (enabled: boolean) => void;
}) {
  const autoBusy = isBusy("auto");
  return (
    <section className={`mbs-me mbs-me--${own ? "shared" : "empty"}`}>
      <header className="mbs-me__head">
        <div><p className="eyebrow">My battle stats</p><h2>{own ? "Shared with faction leadership" : "Private — nothing shared"}</h2></div>
        <span className="mbs-me__badge">{own ? <CheckCircle2 size={18} /> : <Lock size={18} />}</span>
      </header>
      <div className="mbs-me__who"><TornUserLink name={name} tornUserId={tornUserId} /></div>
      {feedback && <p className={`mbs-inline-note mbs-inline-note--${feedback.tone}`}>{feedback.tone === "ok" ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />} {feedback.text}</p>}

      {!databaseAvailable && (
        <p className="mbs-inline-note mbs-inline-note--warn"><TriangleAlert size={13} /> Workspace storage is unavailable, so battle stats cannot be shared yet. Create storage in Settings.</p>
      )}

      <div className="mbs-why">
        <span className="mbs-why__icon"><UsersRound size={16} /></span>
        <div>
          <strong>Why your faction leaders need this</strong>
          <p>Battle stats aren&apos;t on Torn&apos;s faction API — leadership can&apos;t see yours unless you share them. With them, your leaders can:</p>
          <ul>
            <li>Build balanced organised-crime and war teams so no slot is the weak link</li>
            <li>Pair chain hitters sensibly and set targets you can actually clear</li>
            <li>See who&apos;s ready for tougher assignments, and who could use stat-building support</li>
          </ul>
          <p className="mbs-why__foot">Without a shared snapshot, they&apos;re guessing.</p>
        </div>
      </div>

      <div className="mbs-privacy">
        <span className="mbs-privacy__icon"><Lock size={16} /></span>
        <div>
          <strong>Only your faction leaders can see this</strong>
          <p>
            Your snapshot is visible to <strong>Administrators and the faction owner only</strong> — never to other
            faction members, and never sent to any third party or shown outside this workspace. It is stored against
            your name for your faction alone. Withdraw and it is deleted straight away.
          </p>
        </div>
      </div>

      {own ? (
        <>
          <div className="mbs-me__grid">
            <MeStat label="Strength" value={own.stats.strength} />
            <MeStat label="Defense" value={own.stats.defense} />
            <MeStat label="Speed" value={own.stats.speed} />
            <MeStat label="Dexterity" value={own.stats.dexterity} />
            <MeStat label="Total" value={own.stats.total} strong />
          </div>
          <p className={`mbs-inline-note mbs-inline-note--${ownFresh ? "ok" : "warn"}`}>
            {ownFresh ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />} Shared {formatWhen(own.statsAt, nowMs)}{ownFresh ? "" : ` — over ${Math.round(STATS_FRESH_MS / 86_400_000)} days old, please refresh`}.
          </p>
          <div className="mbs-action-row">
            <button type="button" className="button button--primary" disabled={pending} onClick={onRefresh}>{isBusy("refresh") ? <Spinner size={13} label="Working" /> : <RefreshCw size={14} />} Refresh now</button>
            <button type="button" className="button button--danger" disabled={pending} onClick={onWithdraw}>{isBusy("withdraw") ? <Spinner size={13} label="Working" /> : <Trash2 size={14} />} Withdraw</button>
          </div>
        </>
      ) : (
        <div className="mbs-me__cta">
          <p>Sharing reads a snapshot of your four battle stats and their total from your own Torn key — nothing else is read or stored — and you can withdraw at any time.</p>
          <button type="button" className="button button--primary mbs-me__share" disabled={pending || !databaseAvailable} onClick={onShare}>{isBusy("share") ? <Spinner size={14} label="Working" /> : <UploadCloud size={15} />} Share my stats</button>
          <p className="mbs-hint"><ShieldCheck size={12} /> Your Torn API key must include battle-stat access. If it doesn&apos;t, the message above will say so after you try.</p>
        </div>
      )}

      <label className={`mbs-toggle${autoBusy ? " mbs-toggle--busy" : ""}`}>
        <input type="checkbox" checked={autoShareOn} disabled={pending || !databaseAvailable} onChange={(event) => onSetAutoShare(event.target.checked)} />
        <span className="mbs-toggle__track" aria-hidden><span /></span>
        <span className="mbs-toggle__text">
          <strong>Keep my shared stats fresh automatically{autoBusy && <span className="mbs-toggle__spin"><Spinner size={12} label="Updating automatic sharing" /> Working…</span>}</strong>
          <small>Re-share when you open this page and the last snapshot is over 12 hours old. Turning this on shares once now.</small>
        </span>
      </label>
    </section>
  );
}

/* ---------------------------------------------------------- leadership roster */

interface RosterRow {
  tornUserId: number;
  name: string;
  level: number;
  position: string;
  stats: MemberBattleStats["stats"];
  statsAt: string;
}

function LeadershipRoster({
  records, roster, message, databaseAvailable, nowMs, pending, isBusy, onRemove,
}: {
  records: MemberBattleStats[];
  roster: TornRosterMember[];
  message: string;
  databaseAvailable: boolean;
  nowMs: number;
  pending: boolean;
  isBusy: (key: string) => boolean;
  onRemove: (tornUserId: number) => void;
}) {
  const [sort, setSort] = useState<SortKey>("total");
  const rosterById = new Map(roster.map((member) => [member.tornId, member]));

  const rows: RosterRow[] = records.map((record) => {
    const member = rosterById.get(record.tornUserId);
    return {
      tornUserId: record.tornUserId,
      name: member?.name ?? `Player ${record.tornUserId}`,
      level: member?.level ?? 0,
      position: member?.position || (member ? "Unassigned" : "Left the faction"),
      stats: record.stats,
      statsAt: record.statsAt,
    };
  });
  rows.sort((a, b) => compareRows(a, b, sort));

  const missing = roster.filter((member) => !records.some((record) => record.tornUserId === member.tornId));

  const max = {
    strength: Math.max(1, ...rows.map((row) => row.stats.strength)),
    defense: Math.max(1, ...rows.map((row) => row.stats.defense)),
    speed: Math.max(1, ...rows.map((row) => row.stats.speed)),
    dexterity: Math.max(1, ...rows.map((row) => row.stats.dexterity)),
    total: Math.max(1, ...rows.map((row) => row.stats.total)),
  };

  if (rows.length === 0) {
    return (
      <section className="panel">
        <div className="section-heading"><div><h2>Shared battle stats</h2><p>0 sharing · {missing.length} not sharing</p></div><span className="analytics-panel-icon"><Gauge size={17} /></span></div>
        <div className="mbs-empty">
          <span><CircleSlash size={20} /></span>
          <div><strong>No shared battle stats yet</strong><p>{databaseAvailable ? "Ask members to open Members → Battle stats and share from their own key." : message}</p></div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel mbs-review">
      <div className="section-heading"><div><h2>Shared battle stats</h2><p>{rows.length} sharing · {missing.length} not sharing</p></div><span className="analytics-panel-icon"><Gauge size={17} /></span></div>
      <div className="mbs-panel__body">
        <div className="mbs-sort-row" role="group" aria-label="Sort shared battle stats">
          <span>Sort</span>
          {([["total", "Total"], ["strength", "Str"], ["defense", "Def"], ["speed", "Spd"], ["dexterity", "Dex"], ["level", "Lvl"], ["name", "Name"]] as const).map(([key, label]) => (
            <button type="button" key={key} aria-pressed={sort === key} className={sort === key ? "mbs-sort--active" : undefined} onClick={() => setSort(key)}>{label}</button>
          ))}
        </div>
        <div className="table-scroll mbs-review__scroll" role="region" aria-label="Member battle stats" tabIndex={0}>
          <table className="data-table mbs-review__table">
            <thead>
              <tr><th className="mbs-rank-h">#</th><th>Member</th><th className="mbs-num">Lvl</th><th className="mbs-num">Strength</th><th className="mbs-num">Defense</th><th className="mbs-num">Speed</th><th className="mbs-num">Dexterity</th><th className="mbs-num">Total</th><th className="mbs-num">Shared</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const fresh = isBattleStatsFresh(row.statsAt, nowMs);
                return (
                  <tr key={row.tornUserId}>
                    <td data-label="Rank" className="mbs-rank">{index + 1}</td>
                    <td data-label="Member"><TornUserLink name={row.name} tornUserId={row.tornUserId} detail={row.position} /></td>
                    <td data-label="Level" className="mbs-num">{row.level || "—"}</td>
                    <StatCell label="Strength" value={row.stats.strength} max={max.strength} />
                    <StatCell label="Defense" value={row.stats.defense} max={max.defense} />
                    <StatCell label="Speed" value={row.stats.speed} max={max.speed} />
                    <StatCell label="Dexterity" value={row.stats.dexterity} max={max.dexterity} />
                    <td data-label="Total" className="mbs-num mbs-num--strong">
                      {formatStat(row.stats.total)}
                      {row.stats.total >= 1_000_000_000 && <span className="mbs-capchip" title="Battle-stat totals above about 1b level off in most contexts.">cap</span>}
                    </td>
                    <td data-label="Shared">
                      <span className={`mbs-fresh mbs-fresh--${fresh ? "ok" : "stale"}`} title={toIsoOrEmpty(row.statsAt)}>
                        {fresh ? <CheckCircle2 size={12} /> : <TriangleAlert size={12} />}
                        {fresh ? formatWhen(row.statsAt, nowMs) : "Stale"}
                      </span>
                    </td>
                    <td data-label="Actions">
                      <button type="button" className="button button--quiet" disabled={pending} onClick={() => onRemove(row.tornUserId)}>
                        {isBusy(`remove:${row.tornUserId}`) ? <Spinner size={12} label="Removing" /> : <Trash2 size={13} />} Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {missing.length > 0 && (
          <details className="mbs-notsharing">
            <summary><TriangleAlert size={13} /><span>{missing.length} not sharing</span><ChevronDown size={14} className="mbs-notsharing__chev" /></summary>
            <p>{missing.map((member) => member.name).join(", ")}</p>
          </details>
        )}
      </div>
    </section>
  );
}

function StatCell({ label, value, max }: { label: string; value: number; max: number }) {
  const pctWidth = Math.max(4, Math.round((value / max) * 100));
  return (
    <td data-label={label} className="mbs-num mbs-statcell">
      <span className="mbs-statcell__bar" aria-hidden><span style={{ width: `${pctWidth}%` }} /></span>
      <span className="mbs-statcell__value">{formatStat(value)}</span>
    </td>
  );
}

function MeStat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <article className={strong ? "mbs-mestat mbs-mestat--strong" : "mbs-mestat"}>
      <small>{label}</small>
      <strong>{formatStat(value)}</strong>
    </article>
  );
}

function compareRows(a: RosterRow, b: RosterRow, sort: SortKey): number {
  if (sort === "name") return a.name.localeCompare(b.name);
  if (sort === "level") return b.level - a.level || a.name.localeCompare(b.name);
  return b.stats[sort] - a.stats[sort] || a.name.localeCompare(b.name);
}

/** Deterministic thousands grouping — never depends on the runtime locale, so
 *  the server HTML and the client's first render produce identical text. */
function groupThousands(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatStat(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}b`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 100_000) return `${Math.round(value / 1_000)}k`;
  return groupThousands(value);
}

function formatWhen(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "recently";
  const diff = nowMs - then;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function toIsoOrEmpty(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
}
