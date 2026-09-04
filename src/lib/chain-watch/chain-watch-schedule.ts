/**
 * Pure slot-scheduling logic, kept free of "server-only" so both the server
 * component (initial render) and the client workspace (live re-computation
 * on a tick) can share one definition of "who is on duty".
 */
export interface ChainWatchSlotLike {
  startAt: string;
  endAt: string;
}

/** The slot covering `nowMs`, if any. Assumes non-overlapping slots. */
export function findActiveSlot<T extends ChainWatchSlotLike>(slots: readonly T[], nowMs: number): T | null {
  return slots.find((slot) => Date.parse(slot.startAt) <= nowMs && nowMs < Date.parse(slot.endAt)) ?? null;
}

/** The earliest slot that starts after `nowMs`. */
export function findNextSlot<T extends ChainWatchSlotLike>(slots: readonly T[], nowMs: number): T | null {
  let next: T | null = null;
  let nextStart = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const start = Date.parse(slot.startAt);
    if (start > nowMs && start < nextStart) {
      next = slot;
      nextStart = start;
    }
  }
  return next;
}

export type SlotStatus = "active" | "upcoming" | "past";

export function slotStatus(slot: ChainWatchSlotLike, nowMs: number): SlotStatus {
  const start = Date.parse(slot.startAt);
  const end = Date.parse(slot.endAt);
  if (nowMs < start) return "upcoming";
  if (nowMs >= end) return "past";
  return "active";
}
