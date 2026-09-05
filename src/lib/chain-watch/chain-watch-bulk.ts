import type { ChainWatchSlotLike } from "./chain-watch-schedule";

export interface PlannedDuplicate {
  sourceSlotId: string;
  startAt: string;
  endAt: string;
}

/**
 * Slots whose `startAt` falls in [rangeStartMs, rangeEndMs), shifted by
 * `offsetMs`. Rotation-generated slots are excluded -- they already recur on
 * their own schedule, so duplicating them forward would double-book their
 * own future instances.
 */
export function planDuplicateSlots<T extends ChainWatchSlotLike & { id: string; rotationId: string | null }>(
  slots: readonly T[],
  rangeStartMs: number,
  rangeEndMs: number,
  offsetMs: number,
): PlannedDuplicate[] {
  return slots
    .filter((slot) => slot.rotationId === null)
    .filter((slot) => {
      const start = Date.parse(slot.startAt);
      return start >= rangeStartMs && start < rangeEndMs;
    })
    .map((slot) => ({
      sourceSlotId: slot.id,
      startAt: new Date(Date.parse(slot.startAt) + offsetMs).toISOString(),
      endAt: new Date(Date.parse(slot.endAt) + offsetMs).toISOString(),
    }));
}
