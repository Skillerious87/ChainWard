"use client";

import { CheckCircle2, CircleSlash, Crosshair, Gauge, RefreshCw, ShieldCheck, Swords, Trash2, TriangleAlert, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  refreshOwnOcIntelAction,
  removeMemberOcIntelAction,
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

interface FeedMeta {
  available: boolean;
  complete: boolean;
  fetchedAt: string | null;
  message: string;
  crimeCount: number;
}

interface OrganizedCrimesWorkspaceProps {
  canReview: boolean;
  reviews: MemberReview[] | null;
  ownIntel: MemberIntel | null;
  currentUser: { tornUserId: number; name: string };
  settings: OcReviewSettings;
  feeds: { live: FeedMeta; history: FeedMeta };
  roster: { available: boolean; message: string; memberCount: number };
}

const VIEWS: readonly View[] = ["overview", "review", "suggestions", "contributions", "my-stats"];

export function OrganizedCrimesWorkspace({ canReview, reviews, ownIntel, currentUser, settings, feeds, roster }: OrganizedCrimesWorkspaceProps) {
  const router = useRouter();
  const { view: rawView, selectView } = useWorkspaceSectionNavigation("organized-crimes");
  const view: View = VIEWS.includes(rawView as View) ? (rawView as View) : "overview";
  const [pending, startTransition] = useTransition();

  const shared = useMemo(() => (reviews ?? []).filter((entry) => entry.intel !== null), [reviews]);
  const missing = useMemo(() => (reviews ?? []).filter((entry) => entry.intel === null), [reviews]);
  const staleCount = useMemo(() => shared.filter((entry) => !entry.statsFresh).length, [shared]);
  const ownFresh = ownIntel ? new Date().getTime() - Date.parse(ownIntel.statsAt) <= STATS_FRESH_MS : false;

  function run(action: () => Promise<OrganizedCrimesActionResult>, failureTitle: string): void {
    startTransition(async () => {
      let result: OrganizedCrimesActionResult;
      try {
        result = await action();
      } catch {
        notify({ title: failureTitle, description: "The request could not reach the server. Nothing was changed.", tone: "danger" });
        return;
      }
      notify({ title: result.ok ? "Organized crimes updated" : failureTitle, description: result.message, tone: result.ok ? "success" : "danger" });
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Organized crimes"
        title="OC battle-stat review"
        description="Connected members share their own battle stats and live checkpoint pass rates so the OC leader can place them in the right OC 2.0 role."
        actions={
          <button type="button" className="button button--secondary" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
            {pending ? <Spinner size={15} label="Refreshing" tone="muted" /> : <RefreshCw size={15} />}
            {pending ? "Working…" : "Refresh"}
          </button>
        }
      />

      {view === "overview" && (
        <Overview
          canReview={canReview}
          sharedCount={shared.length}
          missingCount={missing.length}
          staleCount={staleCount}
          rosterCount={roster.available ? roster.memberCount : null}
          feeds={feeds}
          ownShared={Boolean(ownIntel)}
          ownFresh={ownFresh}
          onGoto={selectView}
        />
      )}

      {view === "review" && (
        canReview
          ? <ReviewTable reviews={shared} missing={missing} rosterAvailable={roster.available} />
          : <LockedPanel />
      )}

      {view === "suggestions" && (
        canReview
          ? <Suggestions reviews={reviews ?? []} settings={settings} live={feeds.live} />
          : <LockedPanel />
      )}

      {view === "contributions" && (
        canReview
          ? (
            <Contributions
              shared={shared}
              missing={missing}
              settings={settings}
              pending={pending}
              onRemove={(tornUserId, name) => run(() => removeMemberOcIntelAction({ tornUserId }), `${name}'s shared data was not removed`)}
              onSaveThreshold={(minimumCpr) => run(() => setOcReviewSettingsAction({ minimumCpr }), "The threshold was not saved")}
            />
          )
          : <LockedPanel />
      )}

      {view === "my-stats" && (
        <MyStats
          name={currentUser.name}
          tornUserId={currentUser.tornUserId}
          intel={ownIntel}
          fresh={ownFresh}
          pending={pending}
          onShare={() => run(shareOwnOcIntelAction, "Your stats were not shared")}
          onRefresh={() => run(refreshOwnOcIntelAction, "Your stats were not refreshed")}
          onWithdraw={() => run(withdrawOwnOcIntelAction, "Your shared data was not removed")}
        />
      )}
    </div>
  );
}

function Overview({ canReview, sharedCount, missingCount, staleCount, rosterCount, feeds, ownShared, ownFresh, onGoto }: {
  canReview: boolean;
  sharedCount: number;
  missingCount: number;
  staleCount: number;
  rosterCount: number | null;
  feeds: { live: FeedMeta; history: FeedMeta };
  ownShared: boolean;
  ownFresh: boolean;
  onGoto: (view: string) => void;
}) {
  return (
    <div className="panel-stack">
      <section className="panel">
        <div className="section-heading">
          <div><h2>Your contribution</h2><p>Only stats you share yourself can be reviewed. Torn does not expose other players&apos; battle stats.</p></div>
          <span className="analytics-panel-icon"><ShieldCheck size={17} /></span>
        </div>
        <p className={`oc-inline-note oc-inline-note--${ownShared ? (ownFresh ? "ok" : "warn") : "warn"}`}>
          {ownShared
            ? ownFresh ? "Your battle stats are shared and current." : "Your shared stats are more than 7 days old — refresh them."
            : "You have not shared your battle stats yet."}
        </p>
        <button type="button" className="button button--primary" onClick={() => onGoto("my-stats")}>
          <UploadCloud size={15} /> {ownShared ? "Manage my stats" : "Share my stats"}
        </button>
      </section>

      {canReview && (
        <section className="panel">
          <div className="section-heading">
            <div><h2>Review readiness</h2><p>What the OC leader can see right now</p></div>
            <span className="analytics-panel-icon"><Swords size={17} /></span>
          </div>
          <div className="oc-stat-grid">
            <OcStat label="Members sharing" value={sharedCount} detail={rosterCount === null ? "Roster unavailable" : `of ${rosterCount} on roster`} />
            <OcStat label="Not sharing" value={missingCount} detail="No stats to review" tone={missingCount ? "warn" : "ok"} />
            <OcStat label="Stale (>7d)" value={staleCount} detail="Ask members to refresh" tone={staleCount ? "warn" : "ok"} />
            <OcStat label="Open OC feed" value={feeds.live.crimeCount} detail={feeds.live.available ? (feeds.live.complete ? "Loaded in full" : "Partial — cap reached") : "Unavailable"} tone={feeds.live.available ? "ok" : "warn"} />
          </div>
          <div className="oc-action-row">
            <button type="button" className="button button--secondary" onClick={() => onGoto("review")}><Gauge size={15} /> Battle-stat table</button>
            <button type="button" className="button button--secondary" onClick={() => onGoto("suggestions")}><Crosshair size={15} /> Role suggestions</button>
            <button type="button" className="button button--secondary" onClick={() => onGoto("contributions")}><ShieldCheck size={15} /> Contributions</button>
          </div>
        </section>
      )}

      <FeedProvenance feeds={feeds} />
    </div>
  );
}

function ReviewTable({ reviews, missing, rosterAvailable }: { reviews: MemberReview[]; missing: MemberReview[]; rosterAvailable: boolean }) {
  const [sort, setSort] = useState<SortKey>("total");
  const rows = useMemo(() => [...reviews].sort((a, b) => compareReview(a, b, sort)), [reviews, sort]);

  if (reviews.length === 0) {
    return (
      <section className="panel">
        <EmptyRow icon={<CircleSlash size={20} />} title="No shared battle stats yet" detail={rosterAvailable ? "Ask members to open Organized crimes and share their stats from the My stats tab." : "The faction roster could not be verified, so nothing can be matched yet."} />
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div><h2>Battle stats</h2><p>{reviews.length} member{reviews.length === 1 ? "" : "s"} sharing · {missing.length} not sharing</p></div>
      </div>
      <div className="oc-sort-row">
        <span>Sort</span>
        {([["total", "Total"], ["strength", "Strength"], ["defense", "Defense"], ["speed", "Speed"], ["dexterity", "Dexterity"], ["level", "Level"], ["name", "Name"]] as const).map(([key, label]) => (
          <button type="button" key={key} aria-pressed={sort === key} className={sort === key ? "oc-sort--active" : undefined} onClick={() => setSort(key)}>{label}</button>
        ))}
      </div>
      <div className="table-scroll" role="region" aria-label="Member battle stats" tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr><th>#</th><th>Member</th><th>Level</th><th>Strength</th><th>Defense</th><th>Speed</th><th>Dexterity</th><th>Total</th><th>Shared</th><th>Current OC</th></tr>
          </thead>
          <tbody>
            {rows.map((entry, index) => (
              <tr key={entry.member.tornId}>
                <td data-label="#">{index + 1}</td>
                <td data-label="Member"><TornUserLink name={entry.member.name} tornUserId={entry.member.tornId} detail={entry.member.position || "Unassigned"} /></td>
                <td data-label="Level">{entry.member.level}</td>
                <td data-label="Strength">{formatStat(entry.intel!.stats.strength)}</td>
                <td data-label="Defense">{formatStat(entry.intel!.stats.defense)}</td>
                <td data-label="Speed">{formatStat(entry.intel!.stats.speed)}</td>
                <td data-label="Dexterity">{formatStat(entry.intel!.stats.dexterity)}</td>
                <td data-label="Total"><strong>{formatStat(entry.intel!.stats.total)}</strong></td>
                <td data-label="Shared"><FreshBadge fresh={entry.statsFresh} at={entry.intel!.statsAt} /></td>
                <td data-label="Current OC">{entry.assignment ?? <span className="muted-value">Available</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && (
        <p className="oc-inline-note oc-inline-note--warn">
          Not sharing: {missing.map((entry) => entry.member.name).join(", ")}
        </p>
      )}
      <FootNote />
    </section>
  );
}

function Suggestions({ reviews, settings, live }: { reviews: MemberReview[]; settings: OcReviewSettings; live: FeedMeta }) {
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
        <div><h2>Role suggestions</h2><p>Open OC slots matched to members with recent checkpoint evidence at or above {settings.minimumCpr}%</p></div>
        <span className="analytics-panel-icon"><Crosshair size={17} /></span>
      </div>

      {!live.available && <p className="oc-inline-note oc-inline-note--warn">The live OC feed is unavailable, so no current openings can be matched.</p>}
      {live.available && !live.complete && <p className="oc-inline-note oc-inline-note--warn">The live OC feed was only read up to the page cap; some openings may be missing.</p>}

      {groups.length === 0
        ? <EmptyRow icon={<CircleSlash size={20} />} title="No qualifying matches" detail="No open slot has a member with fresh personal or recent historical checkpoint evidence meeting the threshold." />
        : (
          <div className="oc-suggestion-list">
            {groups.map((group) => (
              <article key={`${group.crimeId}:${group.positionLabel}`} className="oc-suggestion">
                <header>
                  <h3>{group.crimeName} <span className="muted-value">#{group.crimeId}</span></h3>
                  <p>Difficulty {group.difficulty} · {group.positionLabel}</p>
                </header>
                <ol>
                  {group.candidates.map((candidate) => (
                    <li key={candidate.tornUserId}>
                      <TornUserLink name={candidate.name} tornUserId={candidate.tornUserId} avatar={false} />
                      <span className={`oc-cpr oc-cpr--${candidate.passRate >= 90 ? "high" : candidate.passRate >= 75 ? "mid" : "low"}`}>{Math.round(candidate.passRate)}%</span>
                      <span className={`oc-evidence oc-evidence--${candidate.evidence}`}>{candidate.evidence === "personal" ? "Live personal" : "From history"}</span>
                      <time dateTime={candidate.observedAt}>{formatWhen(candidate.observedAt)}</time>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        )}

      {withoutEvidence > 0 && (
        <p className="oc-inline-note">{withoutEvidence} sharing member{withoutEvidence === 1 ? " has" : "s have"} no checkpoint evidence meeting the current threshold. Their live rates are only counted for 15 minutes after they refresh.</p>
      )}
      <FootNote />
    </section>
  );
}

function Contributions({ shared, missing, settings, pending, onRemove, onSaveThreshold }: {
  shared: MemberReview[];
  missing: MemberReview[];
  settings: OcReviewSettings;
  pending: boolean;
  onRemove: (tornUserId: number, name: string) => void;
  onSaveThreshold: (minimumCpr: number) => void;
}) {
  const [threshold, setThreshold] = useState(settings.minimumCpr);
  const dirty = threshold !== settings.minimumCpr;

  return (
    <div className="panel-stack">
      <section className="panel">
        <div className="section-heading">
          <div><h2>Suggestion threshold</h2><p>Minimum checkpoint pass rate for a member to be suggested for a role</p></div>
          <span className="analytics-panel-icon"><Gauge size={17} /></span>
        </div>
        <div className="oc-threshold-control">
          <input type="range" min={0} max={100} step={1} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} aria-label="Minimum checkpoint pass rate" />
          <strong>{threshold}%</strong>
          <button type="button" className="button button--primary" disabled={!dirty || pending} onClick={() => onSaveThreshold(threshold)}>
            {pending ? <Spinner size={12} label="Saving" /> : null}{dirty ? "Save" : "Saved"}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div><h2>Sharing members</h2><p>{shared.length} sharing · {missing.length} not sharing</p></div>
        </div>
        <div className="table-scroll" role="region" aria-label="Shared OC contributions" tabIndex={0}>
          <table className="data-table">
            <thead><tr><th>Member</th><th>Shared</th><th>Live roles</th><th>Source</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shared.map((entry) => (
                <tr key={entry.member.tornId}>
                  <td data-label="Member"><TornUserLink name={entry.member.name} tornUserId={entry.member.tornId} /></td>
                  <td data-label="Shared"><FreshBadge fresh={entry.statsFresh} at={entry.intel!.statsAt} /></td>
                  <td data-label="Live roles">{entry.intel!.roles.length}</td>
                  <td data-label="Source"><span className="muted-value">{entry.intel!.source === "offline" ? "Offline fixture" : "Torn API v2"}</span></td>
                  <td data-label="Actions">
                    <button type="button" className="button button--danger button--small" disabled={pending} onClick={() => onRemove(entry.member.tornId, entry.member.name)}>
                      <Trash2 size={13} /> Remove
                    </button>
                  </td>
                </tr>
              ))}
              {shared.length === 0 && <tr><td colSpan={5}><span className="muted-value">No members are sharing yet.</span></td></tr>}
            </tbody>
          </table>
        </div>
        {missing.length > 0 && <p className="oc-inline-note oc-inline-note--warn">Not sharing: {missing.map((entry) => entry.member.name).join(", ")}</p>}
      </section>
    </div>
  );
}

function MyStats({ name, tornUserId, intel, fresh, pending, onShare, onRefresh, onWithdraw }: {
  name: string;
  tornUserId: number;
  intel: MemberIntel | null;
  fresh: boolean;
  pending: boolean;
  onShare: () => void;
  onRefresh: () => void;
  onWithdraw: () => void;
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div><h2>My battle stats</h2><p>You control this. Sharing sends your own Torn battle stats and current OC checkpoint rates to the OC leader.</p></div>
        <span className="analytics-panel-icon"><ShieldCheck size={17} /></span>
      </div>

      <div className="oc-me-identity"><TornUserLink name={name} tornUserId={tornUserId} /></div>

      {intel ? (
        <>
          <div className="oc-stat-grid">
            <OcStat label="Strength" value={intel.stats.strength} format />
            <OcStat label="Defense" value={intel.stats.defense} format />
            <OcStat label="Speed" value={intel.stats.speed} format />
            <OcStat label="Dexterity" value={intel.stats.dexterity} format />
          </div>
          <p className={`oc-inline-note oc-inline-note--${fresh ? "ok" : "warn"}`}>
            Total {formatStat(intel.stats.total)} · shared {formatWhen(intel.statsAt)}{fresh ? "" : " · older than 7 days"}. {intel.rolesMessage}
          </p>
          <div className="oc-action-row">
            <button type="button" className="button button--primary" disabled={pending} onClick={onRefresh}>
              {pending ? <Spinner size={13} label="Working" /> : <RefreshCw size={14} />} Refresh now
            </button>
            <button type="button" className="button button--danger" disabled={pending} onClick={onWithdraw}>
              <Trash2 size={14} /> Withdraw
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="oc-inline-note">Nothing is shared. Your stats stay private until you choose to share them, and you can withdraw at any time.</p>
          <button type="button" className="button button--primary" disabled={pending} onClick={onShare}>
            {pending ? <Spinner size={13} label="Working" /> : <UploadCloud size={14} />} Share my stats
          </button>
        </>
      )}
    </section>
  );
}

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
      <EmptyRow icon={<ShieldCheck size={20} />} title="Review access required" detail="Battle-stat review is limited to the faction owner, OC leader, and administrators. You can still share your own stats from the My stats tab." />
    </section>
  );
}

function OcStat({ label, value, detail, tone, format }: { label: string; value: number; detail?: string; tone?: "ok" | "warn"; format?: boolean }) {
  return (
    <article className={tone ? `oc-stat oc-stat--${tone}` : "oc-stat"}>
      <small>{label}</small>
      <strong>{format ? formatStat(value) : value.toLocaleString()}</strong>
      {detail && <p>{detail}</p>}
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

function FreshBadge({ fresh, at }: { fresh: boolean; at: string }) {
  return (
    <span className={`oc-fresh oc-fresh--${fresh ? "ok" : "stale"}`} title={new Date(at).toISOString()}>
      {fresh ? <CheckCircle2 size={12} /> : <TriangleAlert size={12} />}
      {fresh ? formatWhen(at) : "Stale"}
    </span>
  );
}

function FootNote() {
  return (
    <p className="oc-footnote">
      Live personal checkpoint evidence is only counted for 15 minutes after a member refreshes; otherwise completed-crime history from the last 7 days is used. Confirm every placement in Torn before assigning.
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

function formatStat(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}b`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(0)}k`;
  return value.toLocaleString();
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
