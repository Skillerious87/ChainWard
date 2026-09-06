"use client";

import { CheckCircle2, ChevronDown, CircleSlash, Construction, Crosshair, Gauge, Info, Lock, RefreshCw, ShieldCheck, Swords, Trash2, TriangleAlert, UploadCloud, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  autoShareOwnOcIntelAction,
  refreshOwnOcIntelAction,
  removeMemberOcIntelAction,
  setOcAutoShareAction,
  setOcReviewSettingsAction,
  shareOwnOcIntelAction,
  withdrawOwnOcIntelAction,
  type OrganizedCrimesActionResult,
} from "@/app/(platform)/organized-crimes/actions";
import { useWorkspaceSectionNavigation } from "@/components/shell/workspace-section-navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { TornUserLink } from "@/components/ui/torn-user-link";
import { notify } from "@/lib/client-actions";
import { STATS_FRESH_MS, type MemberReview } from "@/lib/organized-crimes/intelligence";
import type { MemberIntel, OcReviewSettings } from "@/lib/organized-crimes/types";

type StatKey = "total" | "strength" | "defense" | "speed" | "dexterity";
type SortKey = StatKey | "name" | "level";
type View = "overview" | "review" | "suggestions" | "contributions" | "my-stats";
type Feedback = { tone: "ok" | "warn"; text: string } | null;
type BusyFn = (key: string) => boolean;

interface FeedMeta {
  available: boolean;
  complete: boolean;
  fetchedAt: string | null;
  message: string;
  crimeCount: number;
}

interface OrganizedCrimesWorkspaceProps {
  canReview: boolean;
  nowMs: number;
  reviews: MemberReview[] | null;
  ownIntel: MemberIntel | null;
  currentUser: { tornUserId: number; name: string };
  autoShare: { enabled: boolean; due: boolean };
  settings: OcReviewSettings;
  feeds: { live: FeedMeta; history: FeedMeta };
  roster: { available: boolean; message: string; memberCount: number };
}

const VIEWS: readonly View[] = ["overview", "review", "suggestions", "contributions", "my-stats"];

export function OrganizedCrimesWorkspace({ canReview, nowMs, reviews, ownIntel, currentUser, autoShare, settings, feeds, roster }: OrganizedCrimesWorkspaceProps) {
  const router = useRouter();
  const { view: rawView } = useWorkspaceSectionNavigation("organized-crimes");
  const view: View = VIEWS.includes(rawView as View) ? (rawView as View) : "overview";
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const autoAttempted = useRef(false);

  const shared = useMemo(() => (reviews ?? []).filter((entry) => entry.intel !== null), [reviews]);
  const missing = useMemo(() => (reviews ?? []).filter((entry) => entry.intel === null), [reviews]);
  const staleCount = useMemo(() => shared.filter((entry) => !entry.statsFresh).length, [shared]);
  const ownFresh = ownIntel ? nowMs - Date.parse(ownIntel.statsAt) <= STATS_FRESH_MS : false;

  // Which specific control is mid-action, so only that one shows a spinner.
  const isBusy: BusyFn = (key) => pending && busyKey === key;

  function run(key: string, action: () => Promise<OrganizedCrimesActionResult>, failureTitle: string): void {
    setFeedback(null);
    setBusyKey(key);
    startTransition(async () => {
      let result: OrganizedCrimesActionResult;
      try {
        result = await action();
      } catch {
        setBusyKey(null);
        setFeedback({ tone: "warn", text: "The request could not reach the server. Nothing was changed." });
        notify({ title: failureTitle, description: "The request could not reach the server.", tone: "danger" });
        return;
      }
      setBusyKey(null);
      setFeedback({ tone: result.ok ? "ok" : "warn", text: result.message });
      notify({ title: result.ok ? "Organized crimes updated" : failureTitle, description: result.message, tone: result.ok ? "success" : "danger" });
      router.refresh();
    });
  }

  // Opted-in members get their snapshot refreshed on arrival when it has gone
  // stale. Runs at most once per mount; the server stamps the cooldown.
  useEffect(() => {
    if (!autoShare.due || autoAttempted.current) return;
    autoAttempted.current = true;
    setBusyKey("auto");
    startTransition(async () => {
      const result = await autoShareOwnOcIntelAction().catch(() => null);
      setBusyKey(null);
      if (result?.ok) {
        setFeedback({ tone: "ok", text: "Your shared stats were refreshed automatically." });
        router.refresh();
      }
    });
  }, [autoShare.due, router]);

  return (
    <div className="page-stack oc-page">
      <PageHeader
        eyebrow="Organized crimes"
        title="OC battle-stat review"
        description="Members share their own live checkpoint pass rates — the figure Torn uses to gate OC 2.0 roles — alongside their battle stats as supporting context, so the OC leader can place each member in the right role."
        actions={
          <button type="button" className="button button--secondary" disabled={pending} onClick={() => { setBusyKey("page"); startTransition(() => router.refresh()); }}>
            {isBusy("page") ? <Spinner size={15} label="Refreshing" tone="muted" /> : <RefreshCw size={15} />}
            <span className="oc-hide-xs">{isBusy("page") ? "Working…" : "Refresh"}</span>
          </button>
        }
      />

      <aside className="oc-devbanner" role="note">
        <Construction size={16} />
        <p><strong>Heavy development.</strong> Organized Crimes is still being built — data, layout and behaviour will change, and numbers may be incomplete.</p>
      </aside>

      {/* Every view is always mounted; only `hidden` toggles. The section
          switcher flips `view` in a post-hydration effect, so conditionally
          mounting whole subtrees here would race hydration. */}
      <div id="organized-crimes-panel-overview" role="tabpanel" aria-labelledby="organized-crimes-tab-overview" hidden={view !== "overview"}>
        <Overview
          canReview={canReview}
          sharedCount={shared.length}
          missingCount={missing.length}
          staleCount={staleCount}
          rosterCount={roster.available ? roster.memberCount : null}
          feeds={feeds}
          ownShared={Boolean(ownIntel)}
          ownFresh={ownFresh}
          autoShareOn={autoShare.enabled}
        />
      </div>

      <div id="organized-crimes-panel-review" role="tabpanel" aria-labelledby="organized-crimes-tab-review" hidden={view !== "review"}>
        {canReview ? <ReviewTable reviews={shared} missing={missing} rosterAvailable={roster.available} nowMs={nowMs} /> : <LockedPanel />}
      </div>

      <div id="organized-crimes-panel-suggestions" role="tabpanel" aria-labelledby="organized-crimes-tab-suggestions" hidden={view !== "suggestions"}>
        {canReview ? <Suggestions reviews={reviews ?? []} settings={settings} live={feeds.live} nowMs={nowMs} /> : <LockedPanel />}
      </div>

      <div id="organized-crimes-panel-contributions" role="tabpanel" aria-labelledby="organized-crimes-tab-contributions" hidden={view !== "contributions"}>
        {canReview
          ? (
            <Contributions
              shared={shared}
              missing={missing}
              settings={settings}
              pending={pending}
              isBusy={isBusy}
              nowMs={nowMs}
              onRemove={(tornUserId, name) => run(`remove:${tornUserId}`, () => removeMemberOcIntelAction({ tornUserId }), `${name}'s shared data was not removed`)}
              onSaveThreshold={(minimumCpr) => run("threshold", () => setOcReviewSettingsAction({ minimumCpr }), "The threshold was not saved")}
            />
          )
          : <LockedPanel />}
      </div>

      <div id="organized-crimes-panel-my-stats" role="tabpanel" aria-labelledby="organized-crimes-tab-my-stats" hidden={view !== "my-stats"}>
        <MyStats
          name={currentUser.name}
          tornUserId={currentUser.tornUserId}
          intel={ownIntel}
          fresh={ownFresh}
          nowMs={nowMs}
          pending={pending}
          isBusy={isBusy}
          feedback={feedback}
          autoShareOn={autoShare.enabled}
          onShare={() => run("share", shareOwnOcIntelAction, "Your stats were not shared")}
          onRefresh={() => run("refresh", refreshOwnOcIntelAction, "Your stats were not refreshed")}
          onWithdraw={() => run("withdraw", withdrawOwnOcIntelAction, "Your shared data was not removed")}
          onSetAutoShare={(enabled) => run("auto", () => setOcAutoShareAction({ enabled }), "Automatic sharing was not changed")}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Overview */

function Overview({ canReview, sharedCount, missingCount, staleCount, rosterCount, feeds, ownShared, ownFresh, autoShareOn }: {
  canReview: boolean;
  sharedCount: number;
  missingCount: number;
  staleCount: number;
  rosterCount: number | null;
  feeds: { live: FeedMeta; history: FeedMeta };
  ownShared: boolean;
  ownFresh: boolean;
  autoShareOn: boolean;
}) {
  const { selectView } = useWorkspaceSectionNavigation("organized-crimes");
  const ownState: "none" | "stale" | "ok" = !ownShared ? "none" : ownFresh ? "ok" : "stale";
  const coverage = rosterCount ? Math.round((sharedCount / rosterCount) * 100) : 0;

  return (
    <div className="oc-stack">
      <section className={`oc-hero oc-hero--${ownState}`}>
        <div className="oc-hero__icon"><ShieldCheck size={20} /></div>
        <div className="oc-hero__body">
          <p className="eyebrow">Your contribution</p>
          <h2>
            {ownState === "none" && "You haven't shared your battle stats yet."}
            {ownState === "stale" && "Your shared stats are over 7 days old."}
            {ownState === "ok" && "Your battle stats are shared and current."}
          </h2>
          <p>Torn doesn&apos;t expose other players&apos; battle stats or checkpoint rates, so members share their own. Checkpoint pass rate is what actually gates OC 2.0 roles; battle stats are supporting context. You can withdraw at any time.{autoShareOn ? " Automatic refresh is on." : ""}</p>
        </div>
        <button type="button" className="button button--primary oc-hero__cta" onClick={() => selectView("my-stats")}>
          <UploadCloud size={15} /> {ownShared ? "Manage sharing" : "Share my stats"}
        </button>
      </section>

      {canReview && (
        <section className="panel oc-readiness">
          <div className="section-heading">
            <div><h2>Review readiness</h2><p>What you can act on right now</p></div>
            <span className="analytics-panel-icon"><Swords size={17} /></span>
          </div>

          <div className="oc-panel__body">
            <div className="oc-kpi-row">
              <Kpi label="Members sharing" value={sharedCount} sub={rosterCount === null ? "Roster unavailable" : `${coverage}% of ${rosterCount} on roster`} />
              <Kpi label="Not sharing" value={missingCount} sub="No stats to review" tone={missingCount ? "warn" : "ok"} />
              <Kpi label="Stale over 7 days" value={staleCount} sub="Ask them to refresh" tone={staleCount ? "warn" : "ok"} />
              <Kpi label="Open OC feed" value={feeds.live.crimeCount} sub={feeds.live.available ? (feeds.live.complete ? "Loaded in full" : "Partial — cap reached") : "Unavailable"} tone={feeds.live.available ? "ok" : "warn"} />
            </div>

            {rosterCount !== null && (
              <div className="oc-coverage" role="img" aria-label={`${coverage}% of the roster is sharing`}>
                <span style={{ width: `${Math.min(100, coverage)}%` }} />
              </div>
            )}

            <div className="oc-jump">
              <JumpCard icon={Crosshair} label="Role suggestions" sub="Members ranked by CPR" onClick={() => selectView("suggestions")} />
              <JumpCard icon={Gauge} label="Battle stats" sub="Supporting context" onClick={() => selectView("review")} />
              <JumpCard icon={ShieldCheck} label="Contributions" sub="Manage who's shared" onClick={() => selectView("contributions")} />
            </div>
          </div>
        </section>
      )}

      <FeedProvenance feeds={feeds} />
    </div>
  );
}

function JumpCard({ icon: Icon, label, sub, onClick }: { icon: typeof Gauge; label: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" className="oc-jumpcard" onClick={onClick}>
      <span className="oc-jumpcard__icon"><Icon size={16} /></span>
      <span className="oc-jumpcard__text"><strong>{label}</strong><small>{sub}</small></span>
    </button>
  );
}

/* -------------------------------------------------------------- Review table */

function ReviewTable({ reviews, missing, rosterAvailable, nowMs }: { reviews: MemberReview[]; missing: MemberReview[]; rosterAvailable: boolean; nowMs: number }) {
  const [sort, setSort] = useState<SortKey>("total");
  const rows = useMemo(() => [...reviews].sort((a, b) => compareReview(a, b, sort)), [reviews, sort]);
  const max = useMemo(() => ({
    strength: Math.max(1, ...reviews.map((r) => r.intel!.stats.strength)),
    defense: Math.max(1, ...reviews.map((r) => r.intel!.stats.defense)),
    speed: Math.max(1, ...reviews.map((r) => r.intel!.stats.speed)),
    dexterity: Math.max(1, ...reviews.map((r) => r.intel!.stats.dexterity)),
    total: Math.max(1, ...reviews.map((r) => r.intel!.stats.total)),
  }), [reviews]);

  if (reviews.length === 0) {
    return (
      <section className="panel">
        <div className="section-heading">
          <div><h2>Battle stats</h2><p>0 sharing · {missing.length} not sharing</p></div>
          <span className="analytics-panel-icon"><Gauge size={17} /></span>
        </div>
        <EmptyRow icon={<CircleSlash size={20} />} title="No shared battle stats yet" detail={rosterAvailable ? "Ask members to open Organized crimes and share their stats from the My stats tab." : "The faction roster could not be verified, so nothing can be matched yet."} />
        {missing.length > 0 && <div className="oc-panel__body oc-panel__body--tight"><NotSharing names={missing.map((entry) => entry.member.name)} /></div>}
      </section>
    );
  }

  return (
    <section className="panel oc-review">
      <div className="section-heading">
        <div><h2>Battle stats</h2><p>{reviews.length} sharing · {missing.length} not sharing</p></div>
        <span className="analytics-panel-icon"><Gauge size={17} /></span>
      </div>

      <div className="oc-panel__body">
        <CprNote />

        <div className="oc-sort-row" role="group" aria-label="Sort battle stats">
          <span>Sort</span>
          {([["total", "Total"], ["strength", "Str"], ["defense", "Def"], ["speed", "Spd"], ["dexterity", "Dex"], ["level", "Lvl"], ["name", "Name"]] as const).map(([key, label]) => (
            <button type="button" key={key} aria-pressed={sort === key} className={sort === key ? "oc-sort--active" : undefined} onClick={() => setSort(key)}>{label}</button>
          ))}
        </div>

        <div className="table-scroll oc-review__scroll" role="region" aria-label="Member battle stats" tabIndex={0}>
          <table className="data-table oc-review__table">
            <thead>
              <tr><th className="oc-rank-h">#</th><th>Member</th><th className="oc-num">Lvl</th><th className="oc-num">Strength</th><th className="oc-num">Defense</th><th className="oc-num">Speed</th><th className="oc-num">Dexterity</th><th className="oc-num">Total</th><th>Shared</th><th>Current OC</th></tr>
            </thead>
            <tbody>
              {rows.map((entry, index) => (
                <tr key={entry.member.tornId}>
                  <td data-label="Rank" className="oc-rank">{index + 1}</td>
                  <td data-label="Member"><TornUserLink name={entry.member.name} tornUserId={entry.member.tornId} detail={entry.member.position || "Unassigned"} /></td>
                  <td data-label="Level" className="oc-num">{entry.member.level}</td>
                  <StatCell label="Strength" value={entry.intel!.stats.strength} max={max.strength} />
                  <StatCell label="Defense" value={entry.intel!.stats.defense} max={max.defense} />
                  <StatCell label="Speed" value={entry.intel!.stats.speed} max={max.speed} />
                  <StatCell label="Dexterity" value={entry.intel!.stats.dexterity} max={max.dexterity} />
                  <td data-label="Total" className="oc-num oc-num--strong">
                  {formatStat(entry.intel!.stats.total)}
                  {entry.intel!.stats.total >= 1_000_000_000 && <span className="oc-capchip" title="Battle stats' contribution to checkpoint pass rate is understood to level off around 1b total.">cap</span>}
                </td>
                  <td data-label="Shared"><FreshBadge fresh={entry.statsFresh} at={entry.intel!.statsAt} nowMs={nowMs} /></td>
                  <td data-label="Current OC">{entry.assignment ? <span className="oc-assigned">{entry.assignment}</span> : <span className="muted-value">Available</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {missing.length > 0 && <NotSharing names={missing.map((entry) => entry.member.name)} />}
        <FootNote />
      </div>
    </section>
  );
}

function StatCell({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.max(4, Math.round((value / max) * 100));
  return (
    <td data-label={label} className="oc-num oc-statcell">
      <span className="oc-statcell__bar" aria-hidden><span style={{ width: `${pct}%` }} /></span>
      <span className="oc-statcell__value">{formatStat(value)}</span>
    </td>
  );
}

function NotSharing({ names }: { names: string[] }) {
  return (
    <details className="oc-notsharing">
      <summary>
        <TriangleAlert size={13} />
        <span>{names.length} not sharing</span>
        <ChevronDown size={14} className="oc-notsharing__chev" />
      </summary>
      <p>{names.join(", ")}</p>
    </details>
  );
}

/* --------------------------------------------------------------- Suggestions */

function Suggestions({ reviews, settings, live, nowMs }: { reviews: MemberReview[]; settings: OcReviewSettings; live: FeedMeta; nowMs: number }) {
  const groups = useMemo(() => {
    const byKey = new Map<string, { crimeName: string; difficulty: number; positionLabel: string; crimeId: number; candidates: Array<{ name: string; tornUserId: number; passRate: number; evidence: "personal" | "history"; observedAt: string }> }>();
    for (const review of reviews) {
      for (const suggestion of review.suggestions) {
        const key = `${suggestion.crimeId}:${suggestion.positionLabel}`;
        const group = byKey.get(key) ?? { crimeName: suggestion.crimeName, difficulty: suggestion.difficulty, positionLabel: suggestion.positionLabel, crimeId: suggestion.crimeId, candidates: [] };
        group.candidates.push({ name: review.member.name, tornUserId: review.member.tornId, passRate: suggestion.passRate, evidence: suggestion.evidence, observedAt: suggestion.observedAt });
        byKey.set(key, group);
      }
    }
    return [...byKey.values()]
      .map((group) => ({ ...group, candidates: group.candidates.sort((a, b) => b.passRate - a.passRate || Number(b.evidence === "personal") - Number(a.evidence === "personal")) }))
      .sort((a, b) => b.difficulty - a.difficulty || a.crimeId - b.crimeId || a.positionLabel.localeCompare(b.positionLabel));
  }, [reviews]);

  const withoutEvidence = reviews.filter((review) => review.intel && review.suggestions.length === 0 && !review.assignment).length;

  return (
    <section className="panel">
      <div className="section-heading">
        <div><h2>Role suggestions</h2><p>Open OC slots matched to members with checkpoint evidence ≥ {settings.minimumCpr}%</p></div>
        <span className="analytics-panel-icon"><Crosshair size={17} /></span>
      </div>

      <div className="oc-panel__body">
        {!live.available && <p className="oc-inline-note oc-inline-note--warn"><TriangleAlert size={13} /> The live OC feed is unavailable, so no current openings can be matched.</p>}
        {live.available && !live.complete && <p className="oc-inline-note oc-inline-note--warn"><TriangleAlert size={13} /> The live OC feed was only read up to the page cap; some openings may be missing.</p>}

        {groups.length === 0
          ? <EmptyRow icon={<CircleSlash size={20} />} title="No qualifying matches" detail="No open slot has a member with fresh personal or recent historical checkpoint evidence meeting the threshold." />
          : (
            <div className="oc-suggestion-list">
              {groups.map((group) => (
                <article key={`${group.crimeId}:${group.positionLabel}`} className="oc-suggestion">
                  <header>
                    <h3>{group.crimeName}</h3>
                    <p><span className="oc-diff">D{group.difficulty}</span> {group.positionLabel} <span className="muted-value">#{group.crimeId}</span></p>
                  </header>
                  <ol>
                    {group.candidates.map((candidate, index) => (
                      <li key={candidate.tornUserId}>
                        <span className={`oc-rankpill${index === 0 ? " oc-rankpill--top" : ""}`}>{index + 1}</span>
                        <span className="oc-suggestion__name"><TornUserLink name={candidate.name} tornUserId={candidate.tornUserId} avatar={false} /></span>
                        <span className={`oc-cpr oc-cpr--${candidate.passRate >= 90 ? "high" : candidate.passRate >= 75 ? "mid" : "low"}`}>{Math.round(candidate.passRate)}%</span>
                        <span className={`oc-evidence oc-evidence--${candidate.evidence}`}>{candidate.evidence === "personal" ? "Live" : "History"}</span>
                        <time dateTime={candidate.observedAt}>{formatWhen(candidate.observedAt, nowMs)}</time>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          )}

        {withoutEvidence > 0 && (
          <p className="oc-inline-note"><Info size={13} /> {withoutEvidence} sharing member{withoutEvidence === 1 ? " has" : "s have"} no checkpoint evidence meeting the threshold. Live personal rates only count for 15 minutes after a member refreshes.</p>
        )}
        <FootNote />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- Contributions */

function Contributions({ shared, missing, settings, pending, isBusy, nowMs, onRemove, onSaveThreshold }: {
  shared: MemberReview[];
  missing: MemberReview[];
  settings: OcReviewSettings;
  pending: boolean;
  isBusy: BusyFn;
  nowMs: number;
  onRemove: (tornUserId: number, name: string) => void;
  onSaveThreshold: (minimumCpr: number) => void;
}) {
  const [threshold, setThreshold] = useState(settings.minimumCpr);
  const dirty = threshold !== settings.minimumCpr;

  return (
    <div className="oc-stack">
      <section className="panel">
        <div className="section-heading">
          <div><h2>Suggestion threshold</h2><p>Minimum checkpoint pass rate for a role suggestion</p></div>
          <span className="analytics-panel-icon"><Gauge size={17} /></span>
        </div>
        <div className="oc-panel__body">
          <div className="oc-threshold-control">
            <input type="range" min={0} max={100} step={1} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} aria-label="Minimum checkpoint pass rate" />
            <strong>{threshold}%</strong>
            <button type="button" className="button button--primary" disabled={!dirty || pending} onClick={() => onSaveThreshold(threshold)}>
              {isBusy("threshold") ? <Spinner size={12} label="Saving" /> : null}{dirty ? "Save" : "Saved"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div><h2>Sharing members</h2><p>{shared.length} sharing · {missing.length} not sharing</p></div>
          <span className="analytics-panel-icon"><Users size={17} /></span>
        </div>
        {shared.length === 0
          ? <EmptyRow icon={<CircleSlash size={20} />} title="No members are sharing yet" detail="Members share from the My stats tab. Their snapshot then appears here for you to manage." />
          : (
            <div className="oc-panel__body oc-panel__body--tight">
              <div className="table-scroll" role="region" aria-label="Shared OC contributions" tabIndex={0}>
                <table className="data-table oc-contrib__table">
                  <thead><tr><th>Member</th><th>Shared</th><th className="oc-num">Live roles</th><th>Source</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {shared.map((entry) => (
                      <tr key={entry.member.tornId}>
                        <td data-label="Member"><TornUserLink name={entry.member.name} tornUserId={entry.member.tornId} /></td>
                        <td data-label="Shared"><FreshBadge fresh={entry.statsFresh} at={entry.intel!.statsAt} nowMs={nowMs} /></td>
                        <td data-label="Live roles" className="oc-num">{entry.intel!.roles.length}</td>
                        <td data-label="Source"><span className="muted-value">{entry.intel!.source === "offline" ? "Offline fixture" : "Torn API v2"}</span></td>
                        <td data-label="Actions">
                          <button type="button" className="button button--danger button--small" disabled={pending} onClick={() => onRemove(entry.member.tornId, entry.member.name)}>
                            {isBusy(`remove:${entry.member.tornId}`) ? <Spinner size={12} label="Removing" /> : <Trash2 size={13} />} Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        {missing.length > 0 && <div className="oc-panel__body oc-panel__body--tight"><NotSharing names={missing.map((entry) => entry.member.name)} /></div>}
      </section>
    </div>
  );
}

/* ----------------------------------------------------------------- My stats */

function MyStats({ name, tornUserId, intel, fresh, nowMs, pending, isBusy, feedback, autoShareOn, onShare, onRefresh, onWithdraw, onSetAutoShare }: {
  name: string;
  tornUserId: number;
  intel: MemberIntel | null;
  fresh: boolean;
  nowMs: number;
  pending: boolean;
  isBusy: BusyFn;
  feedback: Feedback;
  autoShareOn: boolean;
  onShare: () => void;
  onRefresh: () => void;
  onWithdraw: () => void;
  onSetAutoShare: (enabled: boolean) => void;
}) {
  const autoBusy = isBusy("auto");
  return (
    <div className="oc-stack">
      <section className={`oc-me oc-me--${intel ? "shared" : "empty"}`}>
        <header className="oc-me__head">
          <div>
            <p className="eyebrow">My battle stats</p>
            <h2>{intel ? "Shared with your OC leader" : "Private — nothing shared"}</h2>
          </div>
          <span className="oc-me__badge">{intel ? <CheckCircle2 size={18} /> : <Lock size={18} />}</span>
        </header>

        <div className="oc-me__who"><TornUserLink name={name} tornUserId={tornUserId} /></div>

        {feedback && (
          <p className={`oc-inline-note oc-inline-note--${feedback.tone}`}>
            {feedback.tone === "ok" ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />} {feedback.text}
          </p>
        )}

        {intel ? (
          <>
            <div className="oc-me__grid">
              <MeStat label="Strength" value={intel.stats.strength} />
              <MeStat label="Defense" value={intel.stats.defense} />
              <MeStat label="Speed" value={intel.stats.speed} />
              <MeStat label="Dexterity" value={intel.stats.dexterity} />
              <MeStat label="Total" value={intel.stats.total} strong />
            </div>
            <p className={`oc-inline-note oc-inline-note--${fresh ? "ok" : "warn"}`}>
              {fresh ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />} Shared {formatWhen(intel.statsAt, nowMs)}{fresh ? "" : " — over 7 days old, please refresh"}. {intel.rolesMessage}
            </p>
            <div className="oc-action-row">
              <button type="button" className="button button--primary" disabled={pending} onClick={onRefresh}>
                {isBusy("refresh") ? <Spinner size={13} label="Working" /> : <RefreshCw size={14} />} Refresh now
              </button>
              <button type="button" className="button button--danger" disabled={pending} onClick={onWithdraw}>
                {isBusy("withdraw") ? <Spinner size={13} label="Working" /> : <Trash2 size={14} />} Withdraw
              </button>
            </div>
          </>
        ) : (
          <div className="oc-me__cta">
            <p>Sharing sends a snapshot of your live checkpoint pass rates on open OC slots — plus your battle stats as context — to the OC leader. Withdraw at any time.</p>
            <button type="button" className="button button--primary oc-me__share" disabled={pending} onClick={onShare}>
              {isBusy("share") ? <Spinner size={14} label="Working" /> : <UploadCloud size={15} />} Share my stats
            </button>
            <p className="oc-hint"><Info size={12} /> Your Torn API key must include battle-stat access. If it doesn&apos;t, the message above will say so after you try.</p>
          </div>
        )}

        <label className={`oc-toggle${autoBusy ? " oc-toggle--busy" : ""}`}>
          <input type="checkbox" checked={autoShareOn} disabled={pending} onChange={(event) => onSetAutoShare(event.target.checked)} />
          <span className="oc-toggle__track" aria-hidden><span /></span>
          <span className="oc-toggle__text">
            <strong>
              Keep my shared stats fresh automatically
              {autoBusy && <span className="oc-toggle__spin"><Spinner size={12} label="Updating automatic sharing" /> Working…</span>}
            </strong>
            <small>Re-share when you open this page and the last snapshot is over 12 hours old. Turning this on shares once now.</small>
          </span>
        </label>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- shared */

function FeedProvenance({ feeds }: { feeds: { live: FeedMeta; history: FeedMeta } }) {
  return (
    <footer className="oc-provenance">
      <ShieldCheck size={14} />
      <p>
        <strong>Source-labelled.</strong>{" "}
        <span>Battle stats and checkpoint rates come from each member&apos;s own Torn API v2 key. Live OC feed: {feeds.live.message} Completed OC feed: {feeds.history.message}</span>
      </p>
    </footer>
  );
}

function LockedPanel() {
  return (
    <section className="panel">
      <EmptyRow icon={<Lock size={20} />} title="Review access required" detail="Battle-stat review is limited to the faction owner, OC leader, and administrators. You can still share your own stats from the My stats tab." />
    </section>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "ok" | "warn" }) {
  return (
    <article className={tone ? `oc-kpi oc-kpi--${tone}` : "oc-kpi"}>
      <small>{label}</small>
      <strong>{formatCount(value)}</strong>
      {sub && <p>{sub}</p>}
    </article>
  );
}

function MeStat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <article className={strong ? "oc-mestat oc-mestat--strong" : "oc-mestat"}>
      <small>{label}</small>
      <strong>{formatStat(value)}</strong>
    </article>
  );
}

function EmptyRow({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="oc-empty">
      <span>{icon}</span>
      <div><strong>{title}</strong><p>{detail}</p></div>
    </div>
  );
}

function FreshBadge({ fresh, at, nowMs }: { fresh: boolean; at: string; nowMs: number }) {
  return (
    <span className={`oc-fresh oc-fresh--${fresh ? "ok" : "stale"}`} title={toIsoOrEmpty(at)}>
      {fresh ? <CheckCircle2 size={12} /> : <TriangleAlert size={12} />}
      {fresh ? formatWhen(at, nowMs) : "Stale"}
    </span>
  );
}

function CprNote() {
  return (
    <p className="oc-inline-note">
      <Info size={13} />
      <span>
        In OC 2.0 a role&apos;s <strong>checkpoint pass rate (CPR)</strong> is what decides success. It is built on each member&apos;s Crime Experience — which also caps it — and only then do battle stats and crime skills add anything, for the roles that use them (physical roles such as Muscle lean on strength and defense; that contribution is understood to level off around 1b total). Rank members by CPR in <strong>Suggestions</strong>; treat this table as background.
      </span>
    </p>
  );
}

function FootNote() {
  return (
    <p className="oc-footnote">
      Checkpoint pass rate is Torn&apos;s own figure for each open role. Live personal rates count for 15 minutes after a member refreshes; otherwise completed-crime history from the last 7 days is used. Confirm every placement in Torn before assigning.
    </p>
  );
}

function compareReview(a: MemberReview, b: MemberReview, sort: SortKey): number {
  if (sort === "name") return a.member.name.localeCompare(b.member.name);
  if (sort === "level") return b.member.level - a.member.level || a.member.name.localeCompare(b.member.name);
  const left = a.intel?.stats[sort] ?? -1;
  const right = b.intel?.stats[sort] ?? -1;
  return right - left || a.member.name.localeCompare(b.member.name);
}

/** Deterministic thousands grouping — never depends on the runtime locale, so
 *  the server HTML and the client's first render produce identical text. */
function groupThousands(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatCount(value: number): string {
  return Number.isFinite(value) ? groupThousands(value) : "—";
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
