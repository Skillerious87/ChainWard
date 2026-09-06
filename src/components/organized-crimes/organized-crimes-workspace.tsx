"use client";

import { CheckCircle2, ChevronDown, CircleSlash, Coins, Construction, Crosshair, Gauge, Info, Lock, Package, RefreshCw, ShieldCheck, Trash2, TrendingUp, TriangleAlert, UploadCloud, Users } from "lucide-react";
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
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { TornUserLink } from "@/components/ui/torn-user-link";
import { notify } from "@/lib/client-actions";
import { CPR_GREEN, CPR_YELLOW, STATS_FRESH_MS, type MemberReview } from "@/lib/organized-crimes/intelligence";
import type { CprSource, CrimeFill, FactionOcHealth, MemberIntel, OcReviewSettings, ScenarioStat, SlotAssignment } from "@/lib/organized-crimes/types";

type StatKey = "total" | "strength" | "defense" | "speed" | "dexterity";
type SortKey = StatKey | "name" | "level" | "oc";
type View = "overview" | "fill" | "suggestions" | "review" | "contributions" | "my-stats";
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
  crimeFills: CrimeFill[] | null;
  scenarios: ScenarioStat[] | null;
  health: FactionOcHealth | null;
  feeds: { live: FeedMeta; history: FeedMeta };
  roster: { available: boolean; message: string; memberCount: number };
}

const VIEWS: readonly View[] = ["overview", "fill", "suggestions", "review", "contributions", "my-stats"];

const SOURCE_LABEL: Record<CprSource, string> = { "self-report": "Shared", assigned: "Live in OC", history: "History" };

export function OrganizedCrimesWorkspace(props: OrganizedCrimesWorkspaceProps) {
  const { canReview, nowMs, reviews, ownIntel, currentUser, autoShare, settings, crimeFills, scenarios, health, feeds, roster } = props;
  const router = useRouter();
  const { view: rawView } = useWorkspaceSectionNavigation("organized-crimes");
  const view: View = VIEWS.includes(rawView as View) ? (rawView as View) : "overview";
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [profileMember, setProfileMember] = useState<MemberReview | null>(null);
  const autoAttempted = useRef(false);

  const shared = useMemo(() => (reviews ?? []).filter((entry) => entry.intel !== null), [reviews]);
  const missing = useMemo(() => (reviews ?? []).filter((entry) => entry.intel === null), [reviews]);
  const staleCount = useMemo(() => shared.filter((entry) => !entry.statsFresh).length, [shared]);
  const withEvidence = useMemo(() => (reviews ?? []).filter((entry) => (entry.profile?.ocCount ?? 0) > 0 || (entry.intel?.roles.length ?? 0) > 0).length, [reviews]);
  const ownFresh = ownIntel ? nowMs - Date.parse(ownIntel.statsAt) <= STATS_FRESH_MS : false;
  const reviewByMember = useMemo(() => new Map((reviews ?? []).map((r) => [r.member.tornId, r])), [reviews]);

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

  const openProfile = (tornId: number) => {
    const review = reviewByMember.get(tornId);
    if (review) setProfileMember(review);
  };

  return (
    <div className="page-stack oc-page">
      <PageHeader
        eyebrow="Organized crimes"
        title="OC role review"
        description="Checkpoint pass rate (CPR) is Torn's own per-role figure and what actually gates OC 2.0. This mines it from completed crimes, live assignments and members' shared snapshots to fill roles and flag gaps."
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

      <div id="organized-crimes-panel-overview" role="tabpanel" aria-labelledby="organized-crimes-tab-overview" hidden={view !== "overview"}>
        <Overview canReview={canReview} sharedCount={shared.length} missingCount={missing.length} withEvidence={withEvidence} staleCount={staleCount}
          rosterCount={roster.available ? roster.memberCount : null} feeds={feeds} health={health}
          ownShared={Boolean(ownIntel)} ownFresh={ownFresh} autoShareOn={autoShare.enabled} />
      </div>

      <div id="organized-crimes-panel-fill" role="tabpanel" aria-labelledby="organized-crimes-tab-fill" hidden={view !== "fill"}>
        {canReview ? <CrimeFills fills={crimeFills ?? []} liveAvailable={feeds.live.available} nowMs={nowMs} onMember={openProfile} /> : <LockedPanel />}
      </div>

      <div id="organized-crimes-panel-suggestions" role="tabpanel" aria-labelledby="organized-crimes-tab-suggestions" hidden={view !== "suggestions"}>
        {canReview ? <Suggestions reviews={reviews ?? []} settings={settings} live={feeds.live} nowMs={nowMs} onMember={openProfile} /> : <LockedPanel />}
      </div>

      <div id="organized-crimes-panel-review" role="tabpanel" aria-labelledby="organized-crimes-tab-review" hidden={view !== "review"}>
        {canReview ? <ReviewTable reviews={shared} missing={missing} rosterAvailable={roster.available} onMember={openProfile} /> : <LockedPanel />}
      </div>

      <div id="organized-crimes-panel-contributions" role="tabpanel" aria-labelledby="organized-crimes-tab-contributions" hidden={view !== "contributions"}>
        {canReview
          ? (
            <Contributions shared={shared} missing={missing} settings={settings} scenarios={scenarios ?? []} pending={pending} isBusy={isBusy} nowMs={nowMs}
              onRemove={(tornUserId, name) => run(`remove:${tornUserId}`, () => removeMemberOcIntelAction({ tornUserId }), `${name}'s shared data was not removed`)}
              onSaveThreshold={(minimumCpr) => run("threshold", () => setOcReviewSettingsAction({ minimumCpr }), "The threshold was not saved")} />
          )
          : <LockedPanel />}
      </div>

      <div id="organized-crimes-panel-my-stats" role="tabpanel" aria-labelledby="organized-crimes-tab-my-stats" hidden={view !== "my-stats"}>
        <MyStats name={currentUser.name} tornUserId={currentUser.tornUserId} intel={ownIntel} fresh={ownFresh} nowMs={nowMs} pending={pending} isBusy={isBusy}
          feedback={feedback} autoShareOn={autoShare.enabled}
          onShare={() => run("share", shareOwnOcIntelAction, "Your stats were not shared")}
          onRefresh={() => run("refresh", refreshOwnOcIntelAction, "Your stats were not refreshed")}
          onWithdraw={() => run("withdraw", withdrawOwnOcIntelAction, "Your shared data was not removed")}
          onSetAutoShare={(enabled) => run("auto", () => setOcAutoShareAction({ enabled }), "Automatic sharing was not changed")} />
      </div>

      <MemberProfileDialog review={profileMember} nowMs={nowMs} onClose={() => setProfileMember(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ Overview */

function Overview({ canReview, sharedCount, missingCount, withEvidence, staleCount, rosterCount, feeds, health, ownShared, ownFresh, autoShareOn }: {
  canReview: boolean;
  sharedCount: number;
  missingCount: number;
  withEvidence: number;
  staleCount: number;
  rosterCount: number | null;
  feeds: { live: FeedMeta; history: FeedMeta };
  health: FactionOcHealth | null;
  ownShared: boolean;
  ownFresh: boolean;
  autoShareOn: boolean;
}) {
  const { selectView } = useWorkspaceSectionNavigation("organized-crimes");
  const ownState: "none" | "stale" | "ok" = !ownShared ? "none" : ownFresh ? "ok" : "stale";
  const coverage = rosterCount ? Math.round((withEvidence / rosterCount) * 100) : 0;

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
          <p>The review works from completed-crime history with no setup. Sharing adds your live checkpoint pass rates and battle stats on top — you can withdraw at any time.{autoShareOn ? " Automatic refresh is on." : ""}</p>
        </div>
        <button type="button" className="button button--primary oc-hero__cta" onClick={() => selectView("my-stats")}>
          <UploadCloud size={15} /> {ownShared ? "Manage sharing" : "Share my stats"}
        </button>
      </section>

      {canReview && health && (
        <section className="panel oc-readiness">
          <div className="section-heading">
            <div><h2>Faction OC health</h2><p>Last {health.windowDays} days</p></div>
            <span className="analytics-panel-icon"><TrendingUp size={17} /></span>
          </div>
          <div className="oc-panel__body">
            <div className="oc-kpi-row">
              <Kpi label="OC success rate" value={pct(health.successRate)} sub={`${health.completedInWindow} completed`} tone={health.successRate == null ? undefined : health.successRate >= 0.75 ? "ok" : health.successRate >= 0.5 ? undefined : "warn"} raw />
              <Kpi label="Median respect" value={fmtShort(health.medRespect)} sub="Per successful OC" raw />
              <Kpi label="Active OCs" value={health.activeCount} sub={`${health.needsFillingCount} need filling`} tone={health.needsFillingCount ? "warn" : "ok"} />
              <Kpi label="Members with evidence" value={withEvidence} sub={rosterCount === null ? "Roster unavailable" : `${coverage}% of ${rosterCount}`} />
            </div>
            {health.difficultyCoverage.length > 0 && (
              <div className="oc-diffcov" aria-label="Difficulty coverage">
                {health.difficultyCoverage.map((d) => (
                  <span key={d.difficulty} className={`oc-diffcell oc-diffcell--${d.wins === d.attempts ? "ok" : d.wins > 0 ? "part" : "bad"}`} title={`Difficulty ${d.difficulty}: ${d.wins}/${d.attempts} succeeded`}>
                    D{d.difficulty}<i>{d.wins}/{d.attempts}</i>
                  </span>
                ))}
              </div>
            )}
            <div className="oc-jump">
              <JumpCard icon={Crosshair} label="Fill OCs" sub={`${health.needsFillingCount} crime${health.needsFillingCount === 1 ? "" : "s"} open`} onClick={() => selectView("fill")} />
              <JumpCard icon={Users} label="Suggestions" sub="Members by role fit" onClick={() => selectView("suggestions")} />
              <JumpCard icon={Gauge} label="Battle stats" sub="Supporting context" onClick={() => selectView("review")} />
            </div>
          </div>
        </section>
      )}

      {canReview && !health && (
        <section className="panel"><EmptyRow icon={<CircleSlash size={20} />} title="No completed-crime history yet" detail="Once your faction runs OCs, their outcomes and per-role pass rates appear here automatically." /></section>
      )}

      <p className="oc-inline-note oc-inline-note--warn">
        <TriangleAlert size={13} />
        <span>{sharedCount} member{sharedCount === 1 ? "" : "s"} sharing, {missingCount} not; {staleCount} shared snapshot{staleCount === 1 ? "" : "s"} stale. History mining does not need anyone to share.</span>
      </p>

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

/* -------------------------------------------------------------- Fill OCs */

function CrimeFills({ fills, liveAvailable, nowMs, onMember }: { fills: CrimeFill[]; liveAvailable: boolean; nowMs: number; onMember: (id: number) => void }) {
  if (!liveAvailable) {
    return <section className="panel"><EmptyRow icon={<TriangleAlert size={20} />} title="The live OC feed is unavailable" detail="Torn did not return the faction's active crimes, so no fills can be proposed. Try Refresh." /></section>;
  }
  if (fills.length === 0) {
    return <section className="panel"><EmptyRow icon={<CheckCircle2 size={20} />} title="Nothing to fill" detail="No Recruiting or Planning crime currently has an open slot." /></section>;
  }
  return (
    <div className="oc-stack">
      <p className="oc-inline-note"><Info size={13} /><span>An optimal assignment of currently-unassigned members to open slots, maximising estimated success from recency-weighted CPR evidence. It never proposes someone already in an OC. Estimates are heuristic — confirm every placement in Torn.</span></p>
      {fills.map((fill) => <CrimeFillCard key={fill.crimeId} fill={fill} nowMs={nowMs} onMember={onMember} />)}
    </div>
  );
}

function CrimeFillCard({ fill, nowMs, onMember }: { fill: CrimeFill; nowMs: number; onMember: (id: number) => void }) {
  const est = fill.estimatedSuccess;
  const tone = est == null ? "unknown" : est >= 0.75 ? "ok" : est >= 0.5 ? "mid" : "low";
  // Numbered copies of a role share a label; flag only the first as the weak link.
  const weakIndex = fill.weakestSlot == null ? -1 : fill.slots.findIndex((slot) => slot.positionLabel === fill.weakestSlot);
  return (
    <section className="panel oc-fill">
      <header className="oc-fill__head">
        <div>
          <h3>{fill.crimeName} <span className="oc-diff">D{fill.difficulty}</span></h3>
          <p>
            {fill.status === "recruiting" ? "Recruiting" : fill.status === "planning" ? "Planning" : fill.status}
            {fill.expiresAt ? ` · expires ${formatWhen(fill.expiresAt, nowMs)}` : fill.readyAt ? ` · ready ${formatWhen(fill.readyAt, nowMs)}` : ""}
            {" · baseline "}{fill.baseline}%
            {fill.scenario?.successRate != null ? ` · scenario ${Math.round(fill.scenario.successRate * 100)}% success` : ""}
          </p>
        </div>
        <div className={`oc-fill__est oc-fill__est--${tone}`}>
          <small>Est. success</small>
          <strong>{est == null ? "—" : `${Math.round(est * 100)}%`}</strong>
          {fill.estimateBand && <em>{Math.round(fill.estimateBand[0] * 100)}–{Math.round(fill.estimateBand[1] * 100)}%</em>}
        </div>
      </header>
      <div className="oc-fill__body">
        {fill.slots.map((slot, index) => <SlotRow key={`${slot.positionKey}-${index}`} slot={slot} baseline={fill.baseline} weakest={index === weakIndex} onMember={onMember} />)}
        {fill.gaps > 0 && <p className="oc-inline-note oc-inline-note--warn"><TriangleAlert size={13} /><span>{fill.gaps} slot{fill.gaps === 1 ? "" : "s"} have no member with any CPR evidence — recruit, or ask those members to share.</span></p>}
      </div>
    </section>
  );
}

function SlotRow({ slot, baseline, weakest, onMember }: { slot: SlotAssignment; baseline: number; weakest: boolean; onMember: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`oc-slot${slot.assignee ? "" : " oc-slot--gap"}${weakest ? " oc-slot--weak" : ""}`}>
      <div className="oc-slot__role">
        <strong>{slot.positionLabel}</strong>
        {slot.itemRequirementId != null && (
          <span className={`oc-item oc-item--${slot.itemAvailable === false ? "missing" : "ok"}`} title={`Requires item #${slot.itemRequirementId}${slot.itemAvailable === false ? " (not available)" : ""}`}>
            <Package size={11} /> item{slot.itemAvailable === false ? " missing" : ""}
          </span>
        )}
        {weakest && <span className="oc-weakflag">weak link</span>}
      </div>
      <div className="oc-slot__pick">
        {slot.assignee ? (
          <>
            <button type="button" className="oc-linklike" onClick={() => onMember(slot.assignee!.tornUserId)}>{slot.assignee.name}</button>
            <span className={`oc-cpr oc-cpr--${cprBand(slot.weightedCpr ?? 0)}`}>{slot.weightedCpr ?? "—"}%</span>
            {slot.source && <span className={`oc-evidence oc-evidence--${slot.source === "self-report" ? "personal" : "history"}`}>{SOURCE_LABEL[slot.source]}</span>}
            {!slot.meetsBaseline && <span className="oc-belowbase" title={`Below the D-baseline of ${baseline}%`}>below {baseline}%</span>}
          </>
        ) : (
          <span className="muted-value">No qualified member</span>
        )}
        {slot.alternates.length > 0 && (
          <button type="button" className="oc-alt-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {slot.alternates.length} alt{slot.alternates.length === 1 ? "" : "s"} <ChevronDown size={12} className={open ? "oc-rot" : undefined} />
          </button>
        )}
      </div>
      {open && slot.alternates.length > 0 && (
        <ul className="oc-alts">
          {slot.alternates.map((alt) => (
            <li key={alt.tornUserId}>
              <button type="button" className="oc-linklike" onClick={() => onMember(alt.tornUserId)}>{alt.name}</button>
              <span className={`oc-cpr oc-cpr--${cprBand(alt.cpr)}`}>{alt.cpr}%</span>
              <span className={`oc-evidence oc-evidence--${alt.source === "self-report" ? "personal" : "history"}`}>{SOURCE_LABEL[alt.source]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Suggestions */

function Suggestions({ reviews, settings, live, nowMs, onMember }: { reviews: MemberReview[]; settings: OcReviewSettings; live: FeedMeta; nowMs: number; onMember: (id: number) => void }) {
  const groups = useMemo(() => {
    const byKey = new Map<string, { crimeName: string; difficulty: number; positionLabel: string; crimeId: number; candidates: Array<{ name: string; tornUserId: number; passRate: number; evidence: CprSource; observedAt: string; meetsBaseline: boolean }> }>();
    for (const review of reviews) {
      for (const suggestion of review.suggestions) {
        const key = `${suggestion.crimeId}:${suggestion.positionLabel}`;
        const group = byKey.get(key) ?? { crimeName: suggestion.crimeName, difficulty: suggestion.difficulty, positionLabel: suggestion.positionLabel, crimeId: suggestion.crimeId, candidates: [] };
        group.candidates.push({ name: review.member.name, tornUserId: review.member.tornId, passRate: suggestion.passRate, evidence: suggestion.evidence, observedAt: suggestion.observedAt, meetsBaseline: suggestion.meetsBaseline });
        byKey.set(key, group);
      }
    }
    return [...byKey.values()]
      .map((group) => ({ ...group, candidates: group.candidates.sort((a, b) => Number(b.meetsBaseline) - Number(a.meetsBaseline) || b.passRate - a.passRate) }))
      .sort((a, b) => b.difficulty - a.difficulty || a.crimeId - b.crimeId || a.positionLabel.localeCompare(b.positionLabel));
  }, [reviews]);

  const withoutEvidence = reviews.filter((review) => review.suggestions.length === 0 && !review.assignment && (review.profile?.ocCount ?? 0) === 0 && (review.intel?.roles.length ?? 0) === 0).length;

  return (
    <section className="panel">
      <div className="section-heading">
        <div><h2>Role suggestions</h2><p>Open OC slots × members with checkpoint evidence ≥ {settings.minimumCpr}%</p></div>
        <span className="analytics-panel-icon"><Users size={17} /></span>
      </div>

      <div className="oc-panel__body">
        {!live.available && <p className="oc-inline-note oc-inline-note--warn"><TriangleAlert size={13} /><span>The live OC feed is unavailable, so no current openings can be matched.</span></p>}

        {groups.length === 0
          ? <EmptyRow icon={<CircleSlash size={20} />} title="No qualifying matches" detail="No open slot has a member with CPR evidence (shared, live, or from completed-crime history) meeting the threshold." />
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
                        <span className={`oc-rankpill${index === 0 && candidate.meetsBaseline ? " oc-rankpill--top" : ""}`}>{index + 1}</span>
                        <span className="oc-suggestion__name"><button type="button" className="oc-linklike" onClick={() => onMember(candidate.tornUserId)}>{candidate.name}</button></span>
                        <span className={`oc-cpr oc-cpr--${cprBand(candidate.passRate)}`}>{Math.round(candidate.passRate)}%</span>
                        <span className={`oc-evidence oc-evidence--${candidate.evidence === "self-report" ? "personal" : "history"}`}>{SOURCE_LABEL[candidate.evidence]}</span>
                        <time dateTime={candidate.observedAt}>{formatWhen(candidate.observedAt, nowMs)}</time>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          )}

        {withoutEvidence > 0 && (
          <p className="oc-inline-note"><Info size={13} /><span>{withoutEvidence} roster member{withoutEvidence === 1 ? " has" : "s have"} no CPR evidence yet — they need to run an OC or share a snapshot.</span></p>
        )}
        <FootNote />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- Review table */

function ReviewTable({ reviews, missing, rosterAvailable, onMember }: { reviews: MemberReview[]; missing: MemberReview[]; rosterAvailable: boolean; onMember: (id: number) => void }) {
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
        <div className="section-heading"><div><h2>Battle stats</h2><p>0 sharing · {missing.length} not sharing</p></div><span className="analytics-panel-icon"><Gauge size={17} /></span></div>
        <EmptyRow icon={<CircleSlash size={20} />} title="No shared battle stats yet" detail={rosterAvailable ? "Ask members to open Organized crimes and share from the My stats tab. Role review still works from completed-crime history without this." : "The faction roster could not be verified, so nothing can be matched yet."} />
      </section>
    );
  }

  return (
    <section className="panel oc-review">
      <div className="section-heading"><div><h2>Battle stats</h2><p>{reviews.length} sharing · {missing.length} not sharing</p></div><span className="analytics-panel-icon"><Gauge size={17} /></span></div>
      <div className="oc-panel__body">
        <CprNote />
        <div className="oc-sort-row" role="group" aria-label="Sort battle stats">
          <span>Sort</span>
          {([["total", "Total"], ["strength", "Str"], ["defense", "Def"], ["speed", "Spd"], ["dexterity", "Dex"], ["oc", "OC record"], ["level", "Lvl"], ["name", "Name"]] as const).map(([key, label]) => (
            <button type="button" key={key} aria-pressed={sort === key} className={sort === key ? "oc-sort--active" : undefined} onClick={() => setSort(key)}>{label}</button>
          ))}
        </div>
        <div className="table-scroll oc-review__scroll" role="region" aria-label="Member battle stats" tabIndex={0}>
          <table className="data-table oc-review__table">
            <thead>
              <tr><th className="oc-rank-h">#</th><th>Member</th><th className="oc-num">Lvl</th><th className="oc-num">Strength</th><th className="oc-num">Defense</th><th className="oc-num">Speed</th><th className="oc-num">Dexterity</th><th className="oc-num">Total</th><th className="oc-num">OCs</th><th className="oc-num">Success</th><th>Current OC</th></tr>
            </thead>
            <tbody>
              {rows.map((entry, index) => (
                <tr key={entry.member.tornId}>
                  <td data-label="Rank" className="oc-rank">{index + 1}</td>
                  <td data-label="Member"><button type="button" className="oc-linklike oc-linklike--strong" onClick={() => onMember(entry.member.tornId)}>{entry.member.name}</button><small className="cell-subtext">{entry.member.position || "Unassigned"}</small></td>
                  <td data-label="Level" className="oc-num">{entry.member.level}</td>
                  <StatCell label="Strength" value={entry.intel!.stats.strength} max={max.strength} />
                  <StatCell label="Defense" value={entry.intel!.stats.defense} max={max.defense} />
                  <StatCell label="Speed" value={entry.intel!.stats.speed} max={max.speed} />
                  <StatCell label="Dexterity" value={entry.intel!.stats.dexterity} max={max.dexterity} />
                  <td data-label="Total" className="oc-num oc-num--strong">
                    {formatStat(entry.intel!.stats.total)}
                    {entry.intel!.stats.total >= 1_000_000_000 && <span className="oc-capchip" title="Battle stats' contribution to checkpoint pass rate is understood to level off around 1b total.">cap</span>}
                  </td>
                  <td data-label="OCs" className="oc-num">{entry.profile?.ocCount ?? 0}</td>
                  <td data-label="Success" className="oc-num">{entry.profile?.successRate != null ? `${Math.round(entry.profile.successRate * 100)}%` : "—"}</td>
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
  const pctWidth = Math.max(4, Math.round((value / max) * 100));
  return (
    <td data-label={label} className="oc-num oc-statcell">
      <span className="oc-statcell__bar" aria-hidden><span style={{ width: `${pctWidth}%` }} /></span>
      <span className="oc-statcell__value">{formatStat(value)}</span>
    </td>
  );
}

function NotSharing({ names }: { names: string[] }) {
  return (
    <details className="oc-notsharing">
      <summary><TriangleAlert size={13} /><span>{names.length} not sharing</span><ChevronDown size={14} className="oc-notsharing__chev" /></summary>
      <p>{names.join(", ")}</p>
    </details>
  );
}

/* ------------------------------------------------------------- Contributions */

function Contributions({ shared, missing, settings, scenarios, pending, isBusy, nowMs, onRemove, onSaveThreshold }: {
  shared: MemberReview[];
  missing: MemberReview[];
  settings: OcReviewSettings;
  scenarios: ScenarioStat[];
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
        <div className="section-heading"><div><h2>Suggestion threshold</h2><p>Minimum CPR for a suggestion. The per-difficulty baseline (D1–3 70, D4–6 75, D8 60, D9 50) still applies on top.</p></div><span className="analytics-panel-icon"><Gauge size={17} /></span></div>
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

      {scenarios.length > 0 && (
        <section className="panel">
          <div className="section-heading"><div><h2>Scenario intelligence</h2><p>From completed-crime history</p></div><span className="analytics-panel-icon"><Coins size={17} /></span></div>
          <div className="oc-panel__body oc-panel__body--tight">
            <div className="table-scroll" role="region" aria-label="OC scenario stats" tabIndex={0}>
              <table className="data-table oc-scenario__table">
                <thead><tr><th>Scenario</th><th className="oc-num">Runs</th><th className="oc-num">Success</th><th className="oc-num">Med. money</th><th className="oc-num">Med. respect</th><th className="oc-num">Per player</th></tr></thead>
                <tbody>
                  {scenarios.map((s) => (
                    <tr key={s.key}>
                      <td data-label="Scenario">{s.crimeName} <span className="oc-diff">D{s.difficulty}</span></td>
                      <td data-label="Runs" className="oc-num">{s.samples}</td>
                      <td data-label="Success" className="oc-num">{s.successRate != null ? `${Math.round(s.successRate * 100)}%` : "—"}</td>
                      <td data-label="Med. money" className="oc-num">{fmtShort(s.medMoney)}</td>
                      <td data-label="Med. respect" className="oc-num">{fmtShort(s.medRespect)}</td>
                      <td data-label="Per player" className="oc-num">{fmtShort(s.perPlayerMoney)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="section-heading"><div><h2>Sharing members</h2><p>{shared.length} sharing · {missing.length} not sharing</p></div><span className="analytics-panel-icon"><Users size={17} /></span></div>
        {shared.length === 0
          ? <EmptyRow icon={<CircleSlash size={20} />} title="No members are sharing yet" detail="Members share from the My stats tab. Their live CPR + battle stats then appear here. History mining works regardless." />
          : (
            <div className="oc-panel__body oc-panel__body--tight">
              <div className="table-scroll" role="region" aria-label="Shared OC contributions" tabIndex={0}>
                <table className="data-table oc-contrib__table">
                  <thead><tr><th>Member</th><th>Shared</th><th className="oc-num">Live roles</th><th className="oc-num">OC history</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {shared.map((entry) => (
                      <tr key={entry.member.tornId}>
                        <td data-label="Member"><TornUserLink name={entry.member.name} tornUserId={entry.member.tornId} /></td>
                        <td data-label="Shared"><FreshBadge fresh={entry.statsFresh} at={entry.intel!.statsAt} nowMs={nowMs} /></td>
                        <td data-label="Live roles" className="oc-num">{entry.intel!.roles.length}</td>
                        <td data-label="OC history" className="oc-num">{entry.profile?.ocCount ?? 0}</td>
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
          <div><p className="eyebrow">My battle stats</p><h2>{intel ? "Shared with your OC leader" : "Private — nothing shared"}</h2></div>
          <span className="oc-me__badge">{intel ? <CheckCircle2 size={18} /> : <Lock size={18} />}</span>
        </header>
        <div className="oc-me__who"><TornUserLink name={name} tornUserId={tornUserId} /></div>
        {feedback && <p className={`oc-inline-note oc-inline-note--${feedback.tone}`}>{feedback.tone === "ok" ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />} {feedback.text}</p>}

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
              <button type="button" className="button button--primary" disabled={pending} onClick={onRefresh}>{isBusy("refresh") ? <Spinner size={13} label="Working" /> : <RefreshCw size={14} />} Refresh now</button>
              <button type="button" className="button button--danger" disabled={pending} onClick={onWithdraw}>{isBusy("withdraw") ? <Spinner size={13} label="Working" /> : <Trash2 size={14} />} Withdraw</button>
            </div>
          </>
        ) : (
          <div className="oc-me__cta">
            <p>Sharing sends a snapshot of your live checkpoint pass rates on open OC slots — plus your battle stats as context — to the OC leader. Withdraw at any time.</p>
            <button type="button" className="button button--primary oc-me__share" disabled={pending} onClick={onShare}>{isBusy("share") ? <Spinner size={14} label="Working" /> : <UploadCloud size={15} />} Share my stats</button>
            <p className="oc-hint"><Info size={12} /> Your Torn API key must include battle-stat and organized-crimes access. If it doesn&apos;t, the message above will say so after you try.</p>
          </div>
        )}

        <label className={`oc-toggle${autoBusy ? " oc-toggle--busy" : ""}`}>
          <input type="checkbox" checked={autoShareOn} disabled={pending} onChange={(event) => onSetAutoShare(event.target.checked)} />
          <span className="oc-toggle__track" aria-hidden><span /></span>
          <span className="oc-toggle__text">
            <strong>Keep my shared stats fresh automatically{autoBusy && <span className="oc-toggle__spin"><Spinner size={12} label="Updating automatic sharing" /> Working…</span>}</strong>
            <small>Re-share when you open this page and the last snapshot is over 12 hours old. Turning this on shares once now.</small>
          </span>
        </label>
      </section>
    </div>
  );
}

/* ------------------------------------------------------- member profile === */

function MemberProfileDialog({ review, nowMs, onClose }: { review: MemberReview | null; nowMs: number; onClose: () => void }) {
  const profile = review?.profile ?? null;
  return (
    <Dialog open={Boolean(review)} title={review ? review.member.name : "Member OC profile"} description="Organized-crime record mined from completed crimes." confirmLabel="Close" hideCancel onConfirm={onClose} onClose={onClose} className="oc-profile-dialog">
      {review && (
        <div className="oc-profile">
          <div className="oc-profile__top">
            <TornUserLink name={review.member.name} tornUserId={review.member.tornId} detail={`Level ${review.member.level} · ${review.member.position || "Unassigned"}`} />
            {review.assignment && <span className="oc-assigned">In {review.assignment}</span>}
          </div>
          {profile && profile.ocCount > 0 ? (
            <>
              <div className="oc-profile__stats">
                <div><small>OCs run</small><strong>{profile.ocCount}</strong></div>
                <div><small>Success</small><strong>{profile.successRate != null ? `${Math.round(profile.successRate * 100)}%` : "—"}</strong></div>
                <div><small>Win / loss</small><strong>{profile.wins}/{profile.losses}</strong></div>
                <div><small>Last OC</small><strong>{profile.lastOcAt ? formatWhen(profile.lastOcAt, nowMs) : "—"}</strong></div>
              </div>
              <div className="table-scroll" tabIndex={0}>
                <table className="data-table">
                  <thead><tr><th>Role</th><th className="oc-num">Runs</th><th className="oc-num">Won</th><th className="oc-num">Avg CPR</th><th className="oc-num">Best</th><th>Last</th></tr></thead>
                  <tbody>
                    {profile.roles.map((role) => (
                      <tr key={role.roleKey}>
                        <td data-label="Role">{role.positionLabel} <span className="muted-value">{role.crimeName} D{role.difficulty}</span></td>
                        <td data-label="Runs" className="oc-num">{role.count}</td>
                        <td data-label="Won" className="oc-num">{role.wins}</td>
                        <td data-label="Avg CPR" className="oc-num"><span className={`oc-cpr oc-cpr--${cprBand(role.avgCpr)}`}>{role.avgCpr || "—"}%</span></td>
                        <td data-label="Best" className="oc-num">{role.bestCpr || "—"}%</td>
                        <td data-label="Last">{formatWhen(role.lastAt, nowMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="oc-inline-note"><Info size={13} /><span>No completed-crime history for this member in the mined window. If they share a snapshot their live CPR still feeds the review.</span></p>
          )}
          {review.intel && review.intel.roles.length > 0 && (
            <p className="oc-inline-note oc-inline-note--ok"><CheckCircle2 size={13} /><span>{review.intel.roles.length} shared live role rate{review.intel.roles.length === 1 ? "" : "s"} · battle total {formatStat(review.intel.stats.total)}</span></p>
          )}
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------- shared */

function FeedProvenance({ feeds }: { feeds: { live: FeedMeta; history: FeedMeta } }) {
  return (
    <footer className="oc-provenance">
      <ShieldCheck size={14} />
      <p>
        <strong>Source-labelled.</strong>{" "}
        <span>Live assignments and completed-crime history come from the faction key. Shared snapshots come from each member&apos;s own key. Live OC feed: {feeds.live.message} Completed OC feed: {feeds.history.message}</span>
      </p>
    </footer>
  );
}

function LockedPanel() {
  return (
    <section className="panel">
      <EmptyRow icon={<Lock size={20} />} title="Review access required" detail="OC role review is limited to the faction owner, OC leader, and administrators. You can still share your own stats from the My stats tab." />
    </section>
  );
}

function Kpi({ label, value, sub, tone, raw }: { label: string; value: number | string; sub?: string; tone?: "ok" | "warn"; raw?: boolean }) {
  return (
    <article className={tone ? `oc-kpi oc-kpi--${tone}` : "oc-kpi"}>
      <small>{label}</small>
      <strong>{raw ? value : formatCount(typeof value === "number" ? value : 0)}</strong>
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
        In OC 2.0 a role&apos;s <strong>checkpoint pass rate (CPR)</strong> decides success — it is founded on each member&apos;s Crime Experience, which also caps it. Battle stats and crime skills only add on top, for the roles that use them (physical roles like Muscle lean on strength and defense; that contribution levels off around 1b total). Rank members by CPR in <strong>Fill OCs</strong> / <strong>Suggestions</strong>; this table is background.
      </span>
    </p>
  );
}

function FootNote() {
  return (
    <p className="oc-footnote">
      CPR evidence is recency-weighted with a 30-day half-life (never hard-discarded) and drawn from three sources: a member&apos;s shared snapshot, their live slot in an active OC, or their CPR-at-execution in completed crimes. Per-difficulty baselines: D1–3 70%, D4–6 75%, D7 70%, D8 60%, D9 50%. Confirm every placement in Torn before assigning.
    </p>
  );
}

function compareReview(a: MemberReview, b: MemberReview, sort: SortKey): number {
  if (sort === "name") return a.member.name.localeCompare(b.member.name);
  if (sort === "level") return b.member.level - a.member.level || a.member.name.localeCompare(b.member.name);
  if (sort === "oc") {
    const ao = (a.profile?.successRate ?? -1) * 100 + (a.profile?.ocCount ?? 0) / 100;
    const bo = (b.profile?.successRate ?? -1) * 100 + (b.profile?.ocCount ?? 0) / 100;
    return bo - ao || a.member.name.localeCompare(b.member.name);
  }
  const left = a.intel?.stats[sort] ?? -1;
  const right = b.intel?.stats[sort] ?? -1;
  return right - left || a.member.name.localeCompare(b.member.name);
}

function cprBand(cpr: number): "high" | "mid" | "low" {
  if (cpr >= CPR_GREEN) return "high";
  if (cpr >= CPR_YELLOW) return "mid";
  return "low";
}

function pct(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function fmtShort(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}b`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return groupThousands(value);
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
