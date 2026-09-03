"use client";

import {
  Activity,
  AlertTriangle,
  Award,
  BadgeCheck,
  BookOpenText,
  CalendarDays,
  ChevronLeft,
  Clock3,
  Eye,
  ExternalLink,
  FilePlus2,
  History,
  LockKeyhole,
  Medal,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Umbrella,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { addMemberAward, addMemberReport, removeMemberAward } from "@/app/(platform)/members/actions";
import { Dialog } from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { notify } from "@/lib/client-actions";
import { MEMBER_BADGES, memberBadgeDefinition, type MemberBadgeId } from "@/lib/members/member-badges";
import type { MemberActivityAssessment } from "@/lib/members/member-activity-intelligence";
import { buildMemberInactivityInsights, periodDurationSeconds, type MemberInactivityPeriod } from "@/lib/members/member-inactivity";
import type { MemberAward, MemberProfileWorkspace, MemberReportCategory, MemberReportVisibility } from "@/lib/members/member-profile-store";
import type { TornRosterMember } from "@/lib/torn/workspace-types";

interface MemberReportWorkspaceProps {
  member: TornRosterMember;
  factionId: number;
  source: string;
  checkedAt: string;
  profile: MemberProfileWorkspace;
  activity: MemberActivityAssessment;
  thresholdDays: number;
  inactivityPeriods: MemberInactivityPeriod[];
  canManage: boolean;
}

type ActivityTone = "current" | "protected" | "watch" | "attention" | "critical";

interface ActivityPresentation {
  tone: ActivityTone;
  icon: typeof Activity;
  eyebrow: string;
  title: string;
  summary: string;
  badge: string;
  posture: string;
}

const reportCategories: ReadonlyArray<{ id: MemberReportCategory; label: string; detail: string }> = [
  { id: "RECOGNITION", label: "Recognition", detail: "Positive contribution or conduct worth recording." },
  { id: "DEVELOPMENT", label: "Development", detail: "Coaching, goals, or an agreed next step." },
  { id: "INCIDENT", label: "Incident", detail: "A factual operational or conduct record." },
  { id: "GENERAL", label: "General", detail: "Other useful faction context." },
];

export function MemberReportWorkspace({ member, factionId, source, checkedAt, profile, activity, thresholdDays, inactivityPeriods, canManage }: MemberReportWorkspaceProps) {
  const router = useRouter();
  const [reportOpen, setReportOpen] = useState(false);
  const [awardOpen, setAwardOpen] = useState(false);
  const [revoking, setRevoking] = useState<MemberAward | null>(null);
  const [category, setCategory] = useState<MemberReportCategory>("RECOGNITION");
  const [visibility, setVisibility] = useState<MemberReportVisibility>("FACTION");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [badgeId, setBadgeId] = useState<MemberBadgeId>("CHAIN_SENTINEL");
  const [citation, setCitation] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const activeAwards = useMemo(() => profile.awards.filter((award) => !award.revokedAt), [profile.awards]);
  const awardHistory = useMemo(() => profile.awards.filter((award) => award.revokedAt), [profile.awards]);
  const inactivityInsights = useMemo(() => buildMemberInactivityInsights(inactivityPeriods, checkedAt), [checkedAt, inactivityPeriods]);
  const joinedAt = approximateJoinDate(member.daysInFaction, checkedAt);
  const activityPresentation = describeActivity(activity);
  const ActivityIcon = activityPresentation.icon;

  async function saveReport(): Promise<void> {
    const result = await addMemberReport({ factionId, tornUserId: member.tornId, category, visibility, title, body });
    notify({ title: result.ok ? "Report added" : "Report was not saved", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
    setTitle("");
    setBody("");
    setCategory("RECOGNITION");
    setVisibility("FACTION");
    router.refresh();
  }

  async function saveAward(): Promise<void> {
    const result = await addMemberAward({ factionId, tornUserId: member.tornId, badgeId, citation });
    notify({ title: result.ok ? "Badge awarded" : "Badge was not assigned", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
    setCitation("");
    setBadgeId("CHAIN_SENTINEL");
    router.refresh();
  }

  async function revokeAward(): Promise<void> {
    if (!revoking) return;
    const result = await removeMemberAward({ factionId, tornUserId: member.tornId, awardId: revoking.id, reason: revokeReason });
    notify({ title: result.ok ? "Badge revoked" : "Badge was not revoked", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
    setRevokeReason("");
    router.refresh();
  }

  return <div className="page-stack member-report">
    <header className="member-report__navigation">
      <Link href="/members"><ChevronLeft size={15} /> Members</Link>
      <span>Personnel record <i /> #{member.tornId}</span>
    </header>

    <section className={`member-report-hero member-report-hero--${activityPresentation.tone}`}>
      <div className="member-report-hero__identity">
        <MemberAvatar name={member.name} />
        <div className="member-report-hero__copy"><p className="eyebrow">Chainward member report</p><div className="member-report-hero__title-row"><h1>{member.name}</h1><span className={`member-report-hero__state member-report-hero__state--${activityPresentation.tone}`}><ActivityIcon size={12} />{activityPresentation.badge}</span></div><p>{member.position || "Unassigned"} <span>·</span> Level {member.level} <span>·</span> Torn ID {member.tornId}</p></div>
      </div>
      <div className="member-report-hero__actions">
        <a className="button button--secondary" href={`https://www.torn.com/profiles.php?XID=${member.tornId}`} target="_blank" rel="noreferrer">Torn profile <ExternalLink size={14} /></a>
        {canManage && <button className="button button--primary" disabled={!profile.databaseAvailable} onClick={() => setReportOpen(true)}><FilePlus2 size={15} /> Add report</button>}
      </div>
      <div className="member-report-hero__source"><ShieldCheck size={14} /><span><strong>Verified roster facts</strong> from {source}</span><time dateTime={checkedAt}>Checked {formatDateTime(checkedAt)}</time></div>
    </section>

    <ActivitySnapshot activity={activity} thresholdDays={thresholdDays} presentation={activityPresentation} />

    <section className="member-report-facts" aria-label="Current member facts">
      <Fact icon={CalendarDays} label="Faction tenure" value={`${member.daysInFaction.toLocaleString()} days`} detail={joinedAt ? `Approx. since ${joinedAt}` : "Join date unavailable"} />
      <Fact icon={UserRound} label="Position" value={member.position || "Unassigned"} detail={`Level ${member.level}`} />
      <Fact icon={Clock3} label="Last action" value={member.lastAction} detail={formatRelativeActivity(activity.ageSeconds)} />
      <Fact icon={ShieldCheck} label="Torn status" value={member.status || "Unknown"} detail={member.statusDescription || "No status detail"} />
    </section>

    <MemberInactivityRecord activity={activity} periods={inactivityPeriods} checkedAt={checkedAt} periodCount={inactivityInsights.recordedPeriods} averageCompletedSeconds={inactivityInsights.averageCompletedSeconds} longestSeconds={inactivityInsights.longestPeriodSeconds} />

    <section className="member-award-showcase">
      <header><div><p className="eyebrow"><Sparkles size={12} /> Recognition</p><h2>Awards on record</h2><p>Deliberate faction recognition assigned by authorised Chainward managers.</p></div>{canManage && <button className="button button--secondary" disabled={!profile.databaseAvailable} onClick={() => setAwardOpen(true)}><Award size={15} /> Award badge</button>}</header>
      {activeAwards.length ? <div className="member-award-showcase__grid">{activeAwards.map((award) => <AwardCard key={award.id} award={award} canManage={canManage} onRevoke={() => { setRevokeReason(""); setRevoking(award); }} />)}</div> : <div className="member-award-empty"><span><Medal size={22} /></span><div><strong>No awards yet</strong><p>Awards appear here with their citation and the manager who assigned them.</p></div></div>}
    </section>

    <div className="member-report-grid">
      <section className="member-report-journal">
        <header><div><p className="eyebrow"><BookOpenText size={12} /> Faction record</p><h2>Reports and notes</h2><p>Append-only entries preserve who wrote what and when.</p></div>{canManage && <button className="button button--quiet" disabled={!profile.databaseAvailable} onClick={() => setReportOpen(true)}><FilePlus2 size={14} /> New entry</button>}</header>
        {profile.reports.length ? <div className="member-report-timeline">{profile.reports.map((report) => <article key={report.id} className={`member-report-entry member-report-entry--${report.category.toLowerCase()}`}><span><ReportIcon category={report.category} /></span><div><header><div><em>{categoryLabel(report.category)}</em>{report.visibility === "LEADERSHIP" && <small><LockKeyhole size={11} /> Leadership only</small>}</div><time dateTime={report.createdAt}>{formatDateTime(report.createdAt)}</time></header><h3>{report.title}</h3><p>{report.body}</p><footer>Recorded by <strong>{report.authorName}</strong> <span>#{report.authorTornUserId}</span></footer></div></article>)}</div> : <div className="member-report-empty"><MessageSquareText size={22} /><h3>No reports recorded</h3><p>The first factual note, recognition, or development entry will create this member’s Chainward history.</p>{canManage && <button className="button button--secondary" disabled={!profile.databaseAvailable} onClick={() => setReportOpen(true)}>Write first report</button>}</div>}
      </section>

      <aside className="member-report-context">
        <section className="member-report-overview"><header><BookOpenText size={18} /><h2>Record overview</h2></header><dl><div><dt>Reports</dt><dd>{profile.reports.length}</dd></div><div><dt>Active awards</dt><dd>{activeAwards.length}</dd></div><div><dt>Inactivity periods</dt><dd>{inactivityInsights.recordedPeriods}</dd></div><div><dt>Activity posture</dt><dd>{activityPresentation.badge}</dd></div></dl><small>Live roster facts and managed faction context are brought together without changing their source.</small></section>
        <section className="member-report-governance"><header><ShieldCheck size={18} /><h2>Record boundaries</h2></header><ul><li><span>Torn facts</span><strong>Current roster API</strong></li><li><span>Reports</span><strong>{canManage ? "Faction + leadership views" : "Faction-visible only"}</strong></li><li><span>Changes</span><strong>Managers only</strong></li><li><span>History</span><strong>Attribution retained</strong></li></ul></section>
        {awardHistory.length > 0 && <section className="member-award-history"><header><History size={17} /><h2>Revoked awards</h2></header>{awardHistory.map((award) => <article key={award.id}><strong>{memberBadgeDefinition(award.badgeId).label}</strong><span>{award.revokeReason}</span><small>Revoked {formatDateTime(award.revokedAt!)}</small></article>)}</section>}
      </aside>
    </div>

    {!profile.databaseAvailable && <section className="member-report-storage-warning"><LockKeyhole size={18} /><div><strong>Member records are read-only</strong><p>{profile.message}</p></div></section>}

    <Dialog open={reportOpen} className="dialog--member-report" title={`Add report for ${member.name}`} description="Reports are append-only and show their author and creation time." confirmLabel="Add to member record" confirmDisabled={!title.trim() || body.trim().length < 10} onConfirm={saveReport} onClose={() => setReportOpen(false)}>
      <div className="member-report-form">
        <fieldset><legend>Report type</legend><div className="member-report-form__choices">{reportCategories.map((item) => <label key={item.id} className={category === item.id ? "member-report-choice--selected" : undefined}><input type="radio" name="report-category" value={item.id} checked={category === item.id} onChange={() => setCategory(item.id)} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>)}</div></fieldset>
        <label><span>Title <small>{title.length}/80</small></span><input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="A short, factual heading" /></label>
        <label><span>Report <small>{body.length}/1500</small></span><textarea value={body} maxLength={1500} onChange={(event) => setBody(event.target.value)} placeholder="Record useful context, actions, and any agreed next step…" /></label>
        <fieldset><legend>Who can read this entry?</legend><div className="member-report-form__visibility"><label className={visibility === "FACTION" ? "member-report-visibility--selected" : undefined}><input type="radio" name="report-visibility" checked={visibility === "FACTION"} onChange={() => setVisibility("FACTION")} /><ShieldCheck size={15} /><span><strong>Faction</strong><small>Visible to workspace members</small></span></label><label className={visibility === "LEADERSHIP" ? "member-report-visibility--selected" : undefined}><input type="radio" name="report-visibility" checked={visibility === "LEADERSHIP"} onChange={() => setVisibility("LEADERSHIP")} /><LockKeyhole size={15} /><span><strong>Leadership only</strong><small>Visible to member managers</small></span></label></div></fieldset>
      </div>
    </Dialog>

    <Dialog open={awardOpen} className="dialog--member-award" title={`Award ${member.name}`} description="Choose a deliberate faction recognition and explain why it was earned." confirmLabel="Assign badge" confirmDisabled={!citation.trim() || citation.trim().length < 5} onConfirm={saveAward} onClose={() => setAwardOpen(false)}>
      <div className="member-award-form"><div className="member-award-catalogue">{MEMBER_BADGES.map((badge) => <label key={badge.id} className={badgeId === badge.id ? "member-award-option--selected" : undefined}><input type="radio" name="member-badge" value={badge.id} checked={badgeId === badge.id} onChange={() => setBadgeId(badge.id)} /><BadgeGlyph badgeId={badge.id} /><span><strong>{badge.label}</strong><small>{badge.detail}</small></span></label>)}</div><label><span>Award citation <small>{citation.length}/240</small></span><textarea value={citation} maxLength={240} onChange={(event) => setCitation(event.target.value)} placeholder="What did this member do to earn the badge?" /></label><p><ShieldCheck size={14} /> Awards are Chainward faction records, not Torn achievements or automated scores.</p></div>
    </Dialog>

    <Dialog open={Boolean(revoking)} className="dialog--member-award-revoke" title={revoking ? `Revoke ${memberBadgeDefinition(revoking.badgeId).label}?` : "Revoke badge"} description="The badge leaves the active showcase, but its history and attribution remain." destructive confirmLabel="Revoke badge" confirmDisabled={revokeReason.trim().length < 3} onConfirm={revokeAward} onClose={() => setRevoking(null)}>
      <label className="member-award-revoke"><span>Reason for revocation <small>{revokeReason.length}/240</small></span><textarea value={revokeReason} maxLength={240} onChange={(event) => setRevokeReason(event.target.value)} placeholder="Briefly explain why this award is being removed…" /></label>
    </Dialog>
  </div>;
}

function Fact({ icon: Icon, label, value, detail }: { icon: typeof CalendarDays; label: string; value: string; detail: string }) { return <article><span><Icon size={18} /></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>; }
function ActivitySnapshot({ activity, thresholdDays, presentation }: { activity: MemberActivityAssessment; thresholdDays: number; presentation: ActivityPresentation }) {
  const Icon = presentation.icon;
  const managedState = activity.record?.state === "HOLIDAY" ? "Holiday" : activity.record?.state === "WATCH" ? "Watch list" : "Standard policy";
  const managedDetail = activity.record?.state === "HOLIDAY"
    ? activity.record.holidayUntil ? `Protected through ${formatShortDate(activity.record.holidayUntil)}` : "Open-ended protection"
    : activity.record?.state === "WATCH" ? "Manual follow-up" : "No manual override";
  return <section className={`member-report-activity member-report-activity--${presentation.tone}`} aria-labelledby="member-activity-heading">
    <div className="member-report-activity__lead">
      <span className="member-report-activity__icon"><Icon size={21} /></span>
      <div><p className="eyebrow">{presentation.eyebrow}</p><h2 id="member-activity-heading">{presentation.title}</h2><p>{presentation.summary}</p></div>
      <span className="member-report-activity__posture"><i />{presentation.posture}</span>
    </div>
    <div className="member-report-activity__details">
      <dl>
        <div><dt>Last active</dt><dd>{formatRelativeActivity(activity.ageSeconds)}</dd><small>Verified Torn timestamp</small></div>
        <div><dt>Review threshold</dt><dd>{thresholdDays} inactive day{thresholdDays === 1 ? "" : "s"}</dd><small>{activity.holidayActive ? "Paused while protected" : "Faction policy"}</small></div>
        <div><dt>Managed state</dt><dd>{managedState}</dd><small>{managedDetail}</small></div>
      </dl>
      {activity.record?.note && <div className="member-report-activity__note"><MessageSquareText size={14} /><p><strong>Manager note</strong><span>{activity.record.note}</span></p></div>}
      <footer>{activity.record ? <><span>Updated by <strong>{activity.record.updatedByName}</strong></span><time dateTime={activity.record.updatedAt}>{formatDateTime(activity.record.updatedAt)}</time></> : <><span><strong>Standard activity policy</strong></span><span>No managed holiday or watch record</span></>}</footer>
    </div>
  </section>;
}
function MemberInactivityRecord({ activity, periods, checkedAt, periodCount, averageCompletedSeconds, longestSeconds }: { activity: MemberActivityAssessment; periods: MemberInactivityPeriod[]; checkedAt: string; periodCount: number; averageCompletedSeconds: number; longestSeconds: number }) {
  const parsedCheckedAt = Date.parse(checkedAt);
  const checkedAtSeconds = Math.floor((Number.isNaN(parsedCheckedAt) ? Date.now() : parsedCheckedAt) / 1_000);
  const completedCount = periods.filter((period) => period.endedAt !== null).length;
  const hasOpenPeriod = periods.some((period) => period.endedAt === null);
  const stateClass = activity.holidayActive ? " inactivity-period-state--protected" : hasOpenPeriod ? " inactivity-period-state--open" : "";
  const stateLabel = activity.holidayActive ? hasOpenPeriod ? "Inactive · protected" : "Holiday protected" : hasOpenPeriod ? "Currently inactive" : "No open period";
  const emptyDetail = activity.holidayActive
    ? "Holiday protection is active. Verified 24-hour gaps will still be recorded without triggering inactivity attention."
    : "A period will appear after a verified roster check finds this member inactive for at least 24 hours.";
  return <section className={`member-report-inactivity${activity.holidayActive ? " member-report-inactivity--protected" : ""}`}>
    <header><div><p className="eyebrow"><History size={12} /> Activity pattern</p><h2>Inactivity periods</h2><p>Persistent gaps of 24 hours or longer inferred from verified Torn last_action timestamps.</p></div><span className={`inactivity-period-state${stateClass}`}><i />{stateLabel}</span></header>
    {periods.length ? <><dl><div><dt>Periods logged</dt><dd>{periodCount}</dd></div><div><dt>Completed</dt><dd>{completedCount}</dd></div><div><dt>Average completed</dt><dd>{completedCount ? formatInactivityDuration(averageCompletedSeconds) : "—"}</dd></div><div><dt>Longest observed</dt><dd>{formatInactivityDuration(longestSeconds)}</dd></div></dl><div className="member-report-inactivity__timeline">{periods.slice(0, 12).map((period) => <article key={period.id}><span className={period.endedAt ? undefined : "member-report-inactivity__open"}><i /></span><div><strong>{formatShortDateTime(period.startedAt)} <em>to</em> {period.endedAt ? formatShortDateTime(period.endedAt) : "ongoing"}</strong><p className="member-report-inactivity__period-meta"><span>{formatInactivityDuration(periodDurationSeconds(period, checkedAtSeconds))}</span>{period.holidayProtected && <em><Umbrella size={11} />Holiday protected</em>}{period.watchListed && <em><Eye size={11} />Watch-listed</em>}</p><small>First observed {formatShortDateTime(period.firstObservedAt)}</small></div></article>)}</div></> : <div className="member-report-inactivity__empty">{activity.holidayActive ? <Umbrella size={18} /> : <Clock3 size={18} />}<p><strong>No inactivity periods logged</strong><span>{emptyDetail}</span></p></div>}
  </section>;
}
function AwardCard({ award, canManage, onRevoke }: { award: MemberAward; canManage: boolean; onRevoke: () => void }) { const badge = memberBadgeDefinition(award.badgeId); return <article><BadgeGlyph badgeId={award.badgeId} /><div><header><h3>{badge.label}</h3><time dateTime={award.awardedAt}>{formatShortDate(award.awardedAt)}</time></header><p>{award.citation}</p><footer><span>Awarded by <strong>{award.awardedByName}</strong></span>{canManage && <button onClick={onRevoke}>Revoke</button>}</footer></div></article>; }
function BadgeGlyph({ badgeId }: { badgeId: MemberBadgeId }) { const index = MEMBER_BADGES.findIndex((badge) => badge.id === badgeId); const Icon = [Award, BadgeCheck, ShieldCheck, Sparkles, Medal, CalendarDays][index] ?? Award; return <span className={`member-badge-glyph member-badge-glyph--${index + 1}`}><Icon size={20} /></span>; }
function ReportIcon({ category }: { category: MemberReportCategory }) { if (category === "RECOGNITION") return <Sparkles size={15} />; if (category === "DEVELOPMENT") return <BookOpenText size={15} />; if (category === "INCIDENT") return <LockKeyhole size={15} />; return <MessageSquareText size={15} />; }
function describeActivity(activity: MemberActivityAssessment): ActivityPresentation {
  if (activity.holidayActive) return {
    tone: "protected",
    icon: Umbrella,
    eyebrow: "Managed holiday",
    title: "Holiday protection is active",
    summary: activity.record?.holidayUntil ? `Inactivity alerts are paused through ${formatShortDate(activity.record.holidayUntil)}. Torn activity remains visible and continues to build an accurate history.` : "Inactivity alerts are paused until the holiday record is cleared. Torn activity remains visible and continues to build an accurate history.",
    badge: activity.record?.holidayUntil ? `Holiday through ${formatShortDate(activity.record.holidayUntil)}` : "Open-ended holiday",
    posture: "No inactivity alert",
  };
  if (activity.holidayExpired) return {
    tone: activity.critical ? "critical" : "attention",
    icon: AlertTriangle,
    eyebrow: "Holiday ended",
    title: activity.critical ? "Review required after holiday" : "Holiday protection has ended",
    summary: `${activity.reason}. Confirm whether this member has returned or needs a new managed state.`,
    badge: "Holiday expired",
    posture: "Needs review",
  };
  if (activity.record?.state === "WATCH") return {
    tone: "watch",
    icon: Eye,
    eyebrow: "Managed follow-up",
    title: "This member is on the watch list",
    summary: activity.reason,
    badge: "Watch list",
    posture: "Manual follow-up",
  };
  if (activity.critical) return {
    tone: "critical",
    icon: AlertTriangle,
    eyebrow: "Activity alert",
    title: "Critical inactivity review",
    summary: activity.reason,
    badge: "Critical",
    posture: "Action required",
  };
  if (activity.needsAttention || activity.band === "Due soon") return {
    tone: "attention",
    icon: Clock3,
    eyebrow: "Activity signal",
    title: activity.band === "Due soon" ? "Approaching review threshold" : "Activity review is due",
    summary: activity.reason,
    badge: activity.band,
    posture: activity.needsAttention ? "Needs review" : "Monitor",
  };
  return {
    tone: "current",
    icon: Activity,
    eyebrow: "Activity signal",
    title: "Activity is within policy",
    summary: activity.reason,
    badge: activity.band,
    posture: "No action required",
  };
}
function categoryLabel(category: MemberReportCategory): string { return reportCategories.find((item) => item.id === category)?.label ?? category; }
function approximateJoinDate(days: number, checkedAt: string): string | null { const checked = Date.parse(checkedAt); if (Number.isNaN(checked) || !Number.isFinite(days)) return null; return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(checked - days * 86_400_000)); }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "time unavailable" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
function formatShortDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unknown date" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date); }
function formatShortDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unknown" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date); }
function formatInactivityDuration(seconds: number): string { if (!Number.isFinite(seconds) || seconds <= 0) return "—"; if (seconds < 86_400) return `${Math.max(1, Math.round(seconds / 3_600))} hours`; const days = seconds / 86_400; return `${days < 10 ? days.toFixed(1) : Math.round(days)} days`; }
function formatRelativeActivity(seconds: number): string { if (seconds < 3_600) return `${Math.max(0, Math.floor(seconds / 60))} minutes ago`; if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} hours ago`; const days = Math.floor(seconds / 86_400); return `${days} day${days === 1 ? "" : "s"} ago`; }
