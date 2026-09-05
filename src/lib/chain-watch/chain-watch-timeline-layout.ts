import type { ChainWatchSlotLike } from "./chain-watch-schedule";

const DAY_MS = 24 * 60 * 60 * 1_000;
const WEEK_MS = 7 * DAY_MS;

function dateOnlyMs(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Monday-first week containing `anchorMs`, shifted by `weekOffset` whole weeks -- matches the rotation weekday picker's bit order. */
export function weekStartUtcMs(anchorMs: number, weekOffset = 0): number {
  const dayStart = dateOnlyMs(anchorMs);
  const isoWeekday = (new Date(dayStart).getUTCDay() + 6) % 7;
  return dayStart - isoWeekday * DAY_MS + weekOffset * WEEK_MS;
}

export interface TimelineSegment {
  dayIndex: number;
  topPercent: number;
  heightPercent: number;
}

/**
 * 1 or 2 segments (a slot spans at most 24h, so it can cross at most one
 * midnight), clipped to the 7 visible day columns starting at `weekStartMs`.
 */
export function splitSlotIntoDaySegments(slot: ChainWatchSlotLike, weekStartMs: number): TimelineSegment[] {
  const weekEndMs = weekStartMs + WEEK_MS;
  const startMs = Math.max(Date.parse(slot.startAt), weekStartMs);
  const endMs = Math.min(Date.parse(slot.endAt), weekEndMs);
  if (endMs <= startMs) return [];

  const segments: TimelineSegment[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const dayIndex = Math.floor((cursor - weekStartMs) / DAY_MS);
    const dayStart = weekStartMs + dayIndex * DAY_MS;
    const segmentEnd = Math.min(endMs, dayStart + DAY_MS);
    segments.push({
      dayIndex,
      topPercent: ((cursor - dayStart) / DAY_MS) * 100,
      heightPercent: ((segmentEnd - cursor) / DAY_MS) * 100,
    });
    cursor = segmentEnd;
  }
  return segments;
}

export function minutesFromPointerOffset(offsetY: number, columnHeightPx: number): number {
  if (columnHeightPx <= 0) return 0;
  return Math.max(0, Math.min(1439, Math.round((offsetY / columnHeightPx) * 1_440)));
}

export function snapMinutes(minutes: number, snapTo = 15): number {
  return Math.max(0, Math.min(1439, Math.round(minutes / snapTo) * snapTo));
}
