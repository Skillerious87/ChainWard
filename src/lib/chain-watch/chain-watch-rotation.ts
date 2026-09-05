/**
 * Pure rotation-window and materialization-planning logic, kept free of
 * "server-only" so both the store (which persists the plan) and tests can
 * share one definition. A rotation never generates its own concrete slots on
 * the fly at read time (there is no scheduled job in this deployment to walk
 * an RRULE) -- instead `planRotationInstances` computes a bounded batch of
 * concrete instances for the caller to insert as ordinary `ChainWatchSlot`
 * rows, and returns where its round-robin cursor landed so the next call
 * (whenever the horizon next runs low) resumes from there instead of
 * recomputing the rotation's entire history.
 */
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface ChainWatchRotationMember {
  tornUserId: number;
  memberName: string;
}

export interface ChainWatchRotationLike {
  weekdaysMask: number;
  startMinuteUtc: number;
  endMinuteUtc: number;
  members: readonly ChainWatchRotationMember[];
  effectiveFrom: string;
  effectiveUntil: string | null;
  cursorDate: string | null;
  cursorIndex: number | null;
}

export interface PlannedRotationInstance {
  date: string;
  startAt: string;
  endAt: string;
  memberIndex: number;
}

export interface RotationPlan {
  instances: PlannedRotationInstance[];
  nextCursorDate: string | null;
  nextCursorIndex: number | null;
}

/** ISO, Monday-first weekday index (0=Mon..6=Sun) for a UTC-midnight-aligned date, matching `weekdaysMask`'s bit order. */
function isoWeekdayIndex(dateMs: number): number {
  return (new Date(dateMs).getUTCDay() + 6) % 7;
}

function dateOnlyMs(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function rotationAppliesOnDate(rotation: Pick<ChainWatchRotationLike, "weekdaysMask">, dateMs: number): boolean {
  return (rotation.weekdaysMask & (1 << isoWeekdayIndex(dateMs))) !== 0;
}

/** `dateMs` must be a UTC-midnight-aligned calendar date. */
export function rotationWindowForDate(
  rotation: Pick<ChainWatchRotationLike, "startMinuteUtc" | "endMinuteUtc">,
  dateMs: number,
): { startAt: string; endAt: string } {
  const startAt = dateMs + rotation.startMinuteUtc * 60_000;
  const crossesMidnight = rotation.endMinuteUtc <= rotation.startMinuteUtc;
  const endAt = dateMs + (crossesMidnight ? DAY_MS : 0) + rotation.endMinuteUtc * 60_000;
  return { startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString() };
}

export function needsMaterialization(cursorDate: string | null, nowMs: number, refillThresholdDays: number): boolean {
  if (!cursorDate) return true;
  return Date.parse(cursorDate) - nowMs < refillThresholdDays * DAY_MS;
}

/** Advances the round robin from the cursor (or `effectiveFrom` if never generated) up to `horizonEndMs`. Pure -- the caller persists both the instances and the returned cursor atomically. */
export function planRotationInstances(rotation: ChainWatchRotationLike, horizonEndMs: number): RotationPlan {
  if (rotation.members.length === 0) {
    return { instances: [], nextCursorDate: rotation.cursorDate, nextCursorIndex: rotation.cursorIndex };
  }

  const effectiveFromMs = dateOnlyMs(Date.parse(rotation.effectiveFrom));
  const effectiveUntilMs = rotation.effectiveUntil ? dateOnlyMs(Date.parse(rotation.effectiveUntil)) : null;
  let cursorDateMs = rotation.cursorDate ? Date.parse(rotation.cursorDate) : null;
  let cursorIndex = rotation.cursorIndex;

  const startMs = Math.max(cursorDateMs !== null ? cursorDateMs + DAY_MS : effectiveFromMs, effectiveFromMs);
  const instances: PlannedRotationInstance[] = [];

  for (let dateMs = startMs; dateMs < horizonEndMs; dateMs += DAY_MS) {
    if (effectiveUntilMs !== null && dateMs > effectiveUntilMs) break;
    if (!rotationAppliesOnDate(rotation, dateMs)) continue;

    cursorIndex = cursorIndex === null ? 0 : (cursorIndex + 1) % rotation.members.length;
    cursorDateMs = dateMs;
    const window = rotationWindowForDate(rotation, dateMs);
    instances.push({ date: new Date(dateMs).toISOString(), startAt: window.startAt, endAt: window.endAt, memberIndex: cursorIndex });
  }

  return {
    instances,
    nextCursorDate: cursorDateMs !== null ? new Date(cursorDateMs).toISOString() : null,
    nextCursorIndex: cursorIndex,
  };
}
