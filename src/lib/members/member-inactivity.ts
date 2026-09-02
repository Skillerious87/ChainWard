import type { TornRosterMember } from "@/lib/torn/workspace-types";

export const INACTIVITY_PERIOD_MINIMUM_SECONDS = 86_400;

export interface MemberInactivityPeriod {
  id: string;
  tornUserId: number;
  memberName: string;
  startedAt: string;
  qualifyingAt: string;
  firstObservedAt: string;
  lastObservedAt: string;
  endedAt: string | null;
  sourceLastActionAt: number;
  peakDurationSeconds: number;
  holidayProtected: boolean;
  watchListed: boolean;
}

export interface MemberInactivityContext {
  state?: "HOLIDAY" | "WATCH";
  holidayUntil?: string | null;
}

export interface MemberInactivityReconciliation {
  current: MemberInactivityPeriod | null;
  completed: MemberInactivityPeriod | null;
  changed: boolean;
}

export interface MemberInactivityPattern {
  tornUserId: number;
  memberName: string;
  periodCount: number;
  completedCount: number;
  averageDurationSeconds: number;
  longestDurationSeconds: number;
  typicalStartDay: string;
  latestStartedAt: string;
  currentPeriod: MemberInactivityPeriod | null;
}

export interface MemberInactivityInsights {
  recordedPeriods: number;
  completedPeriods: number;
  openPeriods: number;
  repeatMembers: number;
  averageCompletedSeconds: number;
  longestPeriodSeconds: number;
  patterns: MemberInactivityPattern[];
}

/**
 * Reconciles the latest Torn last_action value with a member's one open period.
 * A newer last_action closes the old period at the exact source timestamp and,
 * when that newer action is itself more than a day old, begins the next period.
 */
export function reconcileMemberInactivityPeriod(
  existing: MemberInactivityPeriod | undefined,
  member: Pick<TornRosterMember, "tornId" | "name" | "lastActionAt">,
  context: MemberInactivityContext | undefined,
  checkedAt: string,
  createId: () => string,
): MemberInactivityReconciliation {
  const checkedAtMs = Date.parse(checkedAt);
  const lastActionAt = Number.isFinite(member.lastActionAt) ? Math.floor(member.lastActionAt) : 0;
  if (Number.isNaN(checkedAtMs) || lastActionAt <= 0) {
    return { current: existing ?? null, completed: null, changed: false };
  }

  const checkedAtSeconds = Math.floor(checkedAtMs / 1_000);
  if (lastActionAt > checkedAtSeconds) {
    return { current: existing ?? null, completed: null, changed: false };
  }

  // Ignore an older cached roster response rather than rewriting newer history.
  if (existing && lastActionAt < existing.sourceLastActionAt) {
    return { current: existing, completed: null, changed: false };
  }

  let completed: MemberInactivityPeriod | null = null;
  let current = existing;
  if (current && lastActionAt > current.sourceLastActionAt) {
    const endedAt = new Date(lastActionAt * 1_000).toISOString();
    const durationSeconds = Math.max(0, lastActionAt - Math.floor(Date.parse(current.startedAt) / 1_000));
    completed = {
      ...current,
      memberName: member.name,
      endedAt,
      lastObservedAt: checkedAt,
      peakDurationSeconds: Math.max(current.peakDurationSeconds, durationSeconds),
    };
    current = undefined;
  }

  const ageSeconds = checkedAtSeconds - lastActionAt;
  if (ageSeconds < INACTIVITY_PERIOD_MINIMUM_SECONDS) {
    return { current: null, completed, changed: Boolean(completed) };
  }

  const holidayProtected = isHolidayActive(context, checkedAtSeconds);
  const watchListed = context?.state === "WATCH";
  if (!current) {
    const startedAt = new Date(lastActionAt * 1_000).toISOString();
    return {
      current: {
        id: createId(),
        tornUserId: member.tornId,
        memberName: member.name,
        startedAt,
        qualifyingAt: new Date((lastActionAt + INACTIVITY_PERIOD_MINIMUM_SECONDS) * 1_000).toISOString(),
        firstObservedAt: checkedAt,
        lastObservedAt: checkedAt,
        endedAt: null,
        sourceLastActionAt: lastActionAt,
        peakDurationSeconds: ageSeconds,
        holidayProtected,
        watchListed,
      },
      completed,
      changed: true,
    };
  }

  const next: MemberInactivityPeriod = {
    ...current,
    memberName: member.name,
    lastObservedAt: checkedAt,
    peakDurationSeconds: Math.max(current.peakDurationSeconds, ageSeconds),
    holidayProtected: current.holidayProtected || holidayProtected,
    watchListed: current.watchListed || watchListed,
  };
  return { current: next, completed, changed: completed !== null || !samePeriod(current, next) };
}

export function buildMemberInactivityInsights(periods: MemberInactivityPeriod[], checkedAt: string): MemberInactivityInsights {
  const checkedAtMs = Date.parse(checkedAt);
  const nowSeconds = Math.floor((Number.isNaN(checkedAtMs) ? Date.now() : checkedAtMs) / 1_000);
  const byMember = new Map<number, MemberInactivityPeriod[]>();
  for (const period of periods) {
    const memberPeriods = byMember.get(period.tornUserId) ?? [];
    memberPeriods.push(period);
    byMember.set(period.tornUserId, memberPeriods);
  }

  const patterns = [...byMember.entries()].map<MemberInactivityPattern>(([tornUserId, memberPeriods]) => {
    const ordered = memberPeriods.toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
    const durations = ordered.map((period) => periodDurationSeconds(period, nowSeconds));
    const completed = ordered.filter((period) => period.endedAt !== null);
    return {
      tornUserId,
      memberName: ordered[0]?.memberName ?? `Member ${tornUserId}`,
      periodCount: ordered.length,
      completedCount: completed.length,
      averageDurationSeconds: durations.length ? Math.round(durations.reduce((total, value) => total + value, 0) / durations.length) : 0,
      longestDurationSeconds: Math.max(0, ...durations),
      typicalStartDay: typicalStartDay(ordered),
      latestStartedAt: ordered[0]?.startedAt ?? checkedAt,
      currentPeriod: ordered.find((period) => period.endedAt === null) ?? null,
    };
  }).toSorted((left, right) => Number(Boolean(right.currentPeriod)) - Number(Boolean(left.currentPeriod)) || right.periodCount - left.periodCount || right.longestDurationSeconds - left.longestDurationSeconds || left.memberName.localeCompare(right.memberName));

  const completedDurations = periods.filter((period) => period.endedAt !== null).map((period) => periodDurationSeconds(period, nowSeconds));
  const allDurations = periods.map((period) => periodDurationSeconds(period, nowSeconds));
  return {
    recordedPeriods: periods.length,
    completedPeriods: completedDurations.length,
    openPeriods: periods.filter((period) => period.endedAt === null).length,
    repeatMembers: patterns.filter((pattern) => pattern.periodCount > 1).length,
    averageCompletedSeconds: completedDurations.length ? Math.round(completedDurations.reduce((total, value) => total + value, 0) / completedDurations.length) : 0,
    longestPeriodSeconds: Math.max(0, ...allDurations),
    patterns,
  };
}

export function periodDurationSeconds(period: MemberInactivityPeriod, checkedAtSeconds: number): number {
  const startSeconds = Math.floor(Date.parse(period.startedAt) / 1_000);
  const endSeconds = period.endedAt ? Math.floor(Date.parse(period.endedAt) / 1_000) : checkedAtSeconds;
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return period.peakDurationSeconds;
  return Math.max(period.peakDurationSeconds, endSeconds - startSeconds, 0);
}

function isHolidayActive(context: MemberInactivityContext | undefined, checkedAtSeconds: number): boolean {
  if (context?.state !== "HOLIDAY") return false;
  if (!context.holidayUntil) return true;
  const holidayEnd = Date.parse(context.holidayUntil) / 1_000;
  return Number.isFinite(holidayEnd) && holidayEnd >= checkedAtSeconds;
}

function typicalStartDay(periods: MemberInactivityPeriod[]): string {
  const counts = new Map<number, number>();
  for (const period of periods) {
    const day = new Date(period.startedAt).getUTCDay();
    if (Number.isNaN(day)) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const best = [...counts.entries()].toSorted((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0];
  return best === undefined ? "Unknown" : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][best]!;
}

function samePeriod(left: MemberInactivityPeriod, right: MemberInactivityPeriod): boolean {
  return left.memberName === right.memberName
    && left.lastObservedAt === right.lastObservedAt
    && left.peakDurationSeconds === right.peakDurationSeconds
    && left.holidayProtected === right.holidayProtected
    && left.watchListed === right.watchListed;
}
