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

const STALE_DAYS = Math.round(STATS_FRESH_MS / 86_400_000);

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
        <p className="mbs-note">
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
        <span className="mbs-me__badge">{own ? <CheckCircle2 size={16} /> : <Lock size={16} />}</span>
        <div>
          <p className="eyebrow">My battle stats</p>
          <h2>{own ? "Shared with faction leadership" : "Not shared yet"}</h2>
        </div>
      </header>

      <div className="mbs-me__id"><TornUserLink name={name} tornUserId={tornUserId} /></div>

      {feedback && (
        <p className={`mbs-note mbs-note--${feedback.tone}`}>
          {feedback.tone === "ok" ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />} <span>{feedback.text}</span>
        </p>
      )}
      {!databaseAvailable && (
        <p className="mbs-note mbs-note--warn">
          <TriangleAlert size={13} /> <span>Workspace storage is unavailable, so battle stats cannot be shared yet. Create storage in Settings.</span>
        </p>
      )}

      {own ? (
        <>
          <dl className="mbs-figures">
            <div className="mbs-figure mbs-figure--total"><dt>Total</dt><dd>{formatStat(own.stats.total)}</dd></div>
            <div className="mbs-figure"><dt>Strength</dt><dd>{formatStat(own.stats.strength)}</dd></div>
            <div className="mbs-figure"><dt>Defense</dt><dd>{formatStat(own.stats.defense)}</dd></div>
            <div className="mbs-figure"><dt>Speed</dt><dd>{formatStat(own.stats.speed)}</dd></div>
            <div className="mbs-figure"><dt>Dexterity</dt><dd>{formatStat(own.stats.dexterity)}</dd></div>
          </dl>
          <p className={`mbs-freshline mbs-freshline--${ownFresh ? "ok" : "warn"}`}>
            {ownFresh ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />}
            <span>Shared {formatWhen(own.statsAt, nowMs)}{ownFresh ? "." : ` — over ${STALE_DAYS} days old, a refresh is recommended.`}</span>
          </p>
          <div className="mbs-actions">
            <button type="button" className="button button--primary" disabled={pending} onClick={onRefresh}>
              {isBusy("refresh") ? <Spinner size={13} label="Working" /> : <RefreshCw size={14} />} Refresh now
            </button>
            <button type="button" className="button button--danger" disabled={pending} onClick={onWithdraw}>
              {isBusy("withdraw") ? <Spinner size={13} label="Working" /> : <Trash2 size={14} />} Withdraw
            </button>
          </div>
        </>
      ) : (
        <div className="mbs-cta">
          <p>Sharing reads a snapshot of your four battle stats and their total from your own Torn key — nothing else is read or stored — and you can withdraw at any time.</p>
          <button type="button" className="button button--primary mbs-cta__go" disabled={pending || !databaseAvailable} onClick={onShare}>
            {isBusy("share") ? <Spinner size={14} label="Working" /> : <UploadCloud size={15} />} Share my stats
          </button>
          <p className="mbs-cta__hint"><ShieldCheck size={12} /> Needs a Torn API key with battle-stat access — you&apos;ll get a clear message if it doesn&apos;t.</p>
        </div>
      )}

      <div className="mbs-assure">
        <Lock size={15} />
        <p>
          <strong>Only your faction leaders can see this.</strong> Your snapshot is visible to Administrators and the
          faction owner — never to other faction members, never sent to a third party, and never shown outside this
          workspace. Withdraw and it is deleted immediately.
        </p>
      </div>

      <details className="mbs-why">
        <summary>
          <UsersRound size={14} /> <span>Why leaders ask for this</span>
          <ChevronDown size={14} className="mbs-why__chev" />
        </summary>
        <div className="mbs-why__body">
          <p>Battle stats aren&apos;t on Torn&apos;s faction API, so leadership can&apos;t see yours unless you share. With them, your leaders can:</p>
          <ul>
            <li>Build balanced organised-crime and war teams so no slot is the weak link</li>
            <li>Pair chain hitters sensibly and set targets you can actually clear</li>
            <li>See who&apos;s ready for tougher assignments, and who could use stat-building support</li>
          </ul>
          <p className="mbs-why__foot">Without a shared snapshot, they&apos;re guessing.</p>
        </div>
      </details>

      <label className={`mbs-toggle${autoBusy ? " mbs-toggle--busy" : ""}`}>
        <input type="checkbox" checked={autoShareOn} disabled={pending || !databaseAvailable} onChange={(event) => onSetAutoShare(event.target.checked)} />
        <span className="mbs-toggle__track" aria-hidden><span /></span>
        <span className="mbs-toggle__text">
          <strong>Keep my shared stats fresh automatically{autoBusy && <span className="mbs-toggle__spin"><Spinner size={12} label="Updating automatic sharing" /> Working…</span>}</strong>
          <small>Re-shares when you open this page and the last snapshot is over 12 hours old. Turning this on shares once now.</small>
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
      <div className="mbs-review__body">
        <div className="mbs-sort" role="group" aria-label="Sort shared battle stats">
          <span>Sort</span>
          {([["total", "Total"], ["strength", "Str"], ["defense", "Def"], ["speed", "Spd"], ["dexterity", "Dex"], ["level", "Lvl"], ["name", "Name"]] as const).map(([key, label]) => (
            <button type="button" key={key} aria-pressed={sort === key} className={sort === key ? "mbs-sort--active" : undefined} onClick={() => setSort(key)}>{label}</button>
          ))}
        </div>

        <ul className="mbs-roster">
          {rows.map((row, index) => {
            const fresh = isBattleStatsFresh(row.statsAt, nowMs);
            return (
              <li className="mbs-roster__card" key={row.tornUserId}>
                <span className="mbs-roster__rank">{index + 1}</span>
                <div className="mbs-roster__who">
                  <TornUserLink name={row.name} tornUserId={row.tornUserId} detail={row.position} />
                  <span className="mbs-roster__meta">
                    <span>Lvl {row.level || "—"}</span>
                    <span className={`mbs-fresh mbs-fresh--${fresh ? "ok" : "stale"}`} title={toIsoOrEmpty(row.statsAt)}>
                      {fresh ? <CheckCircle2 size={11} /> : <TriangleAlert size={11} />}
                      {fresh ? formatWhen(row.statsAt, nowMs) : "Stale"}
                    </span>
                  </span>
                </div>
                <dl className="mbs-roster__stats">
                  <div><dt>Str</dt><dd>{formatStat(row.stats.strength)}</dd></div>
                  <div><dt>Def</dt><dd>{formatStat(row.stats.defense)}</dd></div>
                  <div><dt>Spd</dt><dd>{formatStat(row.stats.speed)}</dd></div>
                  <div><dt>Dex</dt><dd>{formatStat(row.stats.dexterity)}</dd></div>
                  <div className="mbs-roster__stat--total">
                    <dt>Total</dt>
                    <dd>{formatStat(row.stats.total)}{row.stats.total >= 1_000_000_000 && <span className="mbs-capchip" title="Battle-stat totals above about 1b level off in most contexts.">cap</span>}</dd>
                  </div>
                </dl>
                <button type="button" className="button button--quiet mbs-roster__remove" disabled={pending} onClick={() => onRemove(row.tornUserId)}>
                  {isBusy(`remove:${row.tornUserId}`) ? <Spinner size={12} label="Removing" /> : <Trash2 size={13} />} Remove
                </button>
              </li>
            );
          })}
        </ul>

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
