"use client";

import { Repeat } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ChainWatchGap } from "@/lib/chain-watch/chain-watch-gaps";
import { minutesFromPointerOffset, snapMinutes, splitSlotIntoDaySegments, weekStartUtcMs } from "@/lib/chain-watch/chain-watch-timeline-layout";
import type { ChainWatchSlot } from "@/lib/chain-watch/chain-watch-store";

const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_HEIGHT_PX = 40;
const COLUMN_HEIGHT_PX = HOUR_HEIGHT_PX * 24;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const HOUR_MARKS = [0, 3, 6, 9, 12, 15, 18, 21] as const;
const DEFAULT_DRAG_MINUTES = 60;

type DragState =
  | { kind: "create"; dayIndex: number; anchorMinutes: number; currentMinutes: number }
  | { kind: "resize"; slotId: string; edge: "start" | "end"; dayIndex: number; currentMinutes: number };

export function ChainWatchTimeline({
  slots,
  gaps,
  now,
  canManage,
  onCreateSlot,
  onOpenRotation,
  onEditSlot,
  onResizeSlot,
}: {
  slots: ChainWatchSlot[];
  gaps: ChainWatchGap[];
  now: number;
  canManage: boolean;
  onCreateSlot: (range: { startAt: string; endAt: string }) => void;
  onOpenRotation: (rotationId: string) => void;
  onEditSlot: (slot: ChainWatchSlot) => void;
  onResizeSlot: (slotId: string, range: { startAt: string; endAt: string }) => Promise<void>;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null);
  const columnRefs = useRef<Array<HTMLDivElement | null>>([]);
  // A resize handle's pointerup can synthesize a click that bubbles to the
  // block's own onClick; this suppresses the one click immediately after a
  // completed resize so it doesn't also pop open the edit dialog.
  const justResizedRef = useRef(false);

  const weekStartMs = useMemo(() => weekStartUtcMs(now, weekOffset), [now, weekOffset]);
  const dayStarts = useMemo(() => Array.from({ length: 7 }, (_, index) => weekStartMs + index * DAY_MS), [weekStartMs]);

  const slotSegments = useMemo(
    () => slots.flatMap((slot) => splitSlotIntoDaySegments(slot, weekStartMs).map((segment) => ({ slot, segment }))),
    [slots, weekStartMs],
  );
  const gapSegments = useMemo(
    () => gaps.flatMap((gap) => splitSlotIntoDaySegments(gap, weekStartMs).map((segment) => ({ gap, segment }))),
    [gaps, weekStartMs],
  );

  function minutesAt(dayIndex: number, clientY: number): number {
    const column = columnRefs.current[dayIndex];
    if (!column) return 0;
    const rect = column.getBoundingClientRect();
    return minutesFromPointerOffset(clientY - rect.top, COLUMN_HEIGHT_PX);
  }

  function beginCreate(dayIndex: number, event: React.PointerEvent<HTMLDivElement>) {
    if (!canManage || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const minutes = snapMinutes(minutesAt(dayIndex, event.clientY));
    setDrag({ kind: "create", dayIndex, anchorMinutes: minutes, currentMinutes: minutes });
  }

  function beginResize(slot: ChainWatchSlot, edge: "start" | "end", dayIndex: number, event: React.PointerEvent<HTMLDivElement>) {
    if (!canManage) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const minutes = snapMinutes(minutesAt(dayIndex, event.clientY));
    setDrag({ kind: "resize", slotId: slot.id, edge, dayIndex, currentMinutes: minutes });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const minutes = snapMinutes(minutesAt(drag.dayIndex, event.clientY));
    setDrag(drag.kind === "create" ? { ...drag, currentMinutes: minutes } : { ...drag, currentMinutes: minutes });
  }

  async function handlePointerUp() {
    if (!drag) return;
    const finished = drag;
    setDrag(null);

    if (finished.kind === "create") {
      const dayStart = dayStarts[finished.dayIndex];
      if (dayStart === undefined) return;
      const [startMinutes, endMinutesRaw] = finished.anchorMinutes <= finished.currentMinutes
        ? [finished.anchorMinutes, finished.currentMinutes]
        : [finished.currentMinutes, finished.anchorMinutes];
      const endMinutes = endMinutesRaw - startMinutes < 15 ? startMinutes + DEFAULT_DRAG_MINUTES : endMinutesRaw;
      onCreateSlot({
        startAt: new Date(dayStart + startMinutes * 60_000).toISOString(),
        endAt: new Date(dayStart + endMinutes * 60_000).toISOString(),
      });
      return;
    }

    justResizedRef.current = true;
    const slot = slots.find((item) => item.id === finished.slotId);
    const dayStart = dayStarts[finished.dayIndex];
    if (!slot || dayStart === undefined) return;
    const draggedAt = dayStart + finished.currentMinutes * 60_000;
    const otherEdgeMs = finished.edge === "start" ? Date.parse(slot.endAt) : Date.parse(slot.startAt);
    const MIN_DURATION_MS = 15 * 60_000;
    const startAtMs = finished.edge === "start" ? Math.min(draggedAt, otherEdgeMs - MIN_DURATION_MS) : otherEdgeMs;
    const endAtMs = finished.edge === "end" ? Math.max(draggedAt, otherEdgeMs + MIN_DURATION_MS) : otherEdgeMs;
    setPendingSlotId(slot.id);
    try {
      await onResizeSlot(slot.id, { startAt: new Date(startAtMs).toISOString(), endAt: new Date(endAtMs).toISOString() });
    } finally {
      setPendingSlotId(null);
    }
  }

  return (
    <div className="chain-watch-timeline">
      <div className="chain-watch-timeline__nav">
        <button className="button button--secondary" type="button" onClick={() => setWeekOffset((value) => value - 1)}>‹ Prev</button>
        <button className="button button--secondary" type="button" onClick={() => setWeekOffset(0)}>Today</button>
        <button className="button button--secondary" type="button" onClick={() => setWeekOffset((value) => value + 1)}>Next ›</button>
        <span className="chain-watch-timeline__range">{formatWeekRange(weekStartMs)}</span>
      </div>

      <div className="chain-watch-timeline__grid" onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={() => setDrag(null)}>
        <div className="chain-watch-timeline__gutter">
          <div className="chain-watch-timeline__gutter-header" />
          <div className="chain-watch-timeline__gutter-body" style={{ height: COLUMN_HEIGHT_PX }}>
            {HOUR_MARKS.map((hour) => <span key={hour} style={{ top: hour * HOUR_HEIGHT_PX }}>{String(hour).padStart(2, "0")}:00</span>)}
          </div>
        </div>

        {dayStarts.map((dayStart, dayIndex) => (
          <div className="chain-watch-timeline__day" key={dayStart}>
            <div className="chain-watch-timeline__day-header">{DAY_LABELS[dayIndex]} {new Date(dayStart).getUTCDate()}</div>
            <div
              className="chain-watch-timeline__column"
              style={{ height: COLUMN_HEIGHT_PX }}
              ref={(node) => { columnRefs.current[dayIndex] = node; }}
              onPointerDown={(event) => { if (event.target === event.currentTarget) beginCreate(dayIndex, event); }}
            >
              {HOUR_MARKS.map((hour) => <div key={hour} className="chain-watch-timeline__hourline" style={{ top: hour * HOUR_HEIGHT_PX }} />)}

              {gapSegments.filter((item) => item.segment.dayIndex === dayIndex).map(({ gap, segment }) => (
                <div
                  key={`${gap.startAt}-gap`}
                  className="chain-watch-timeline__gap"
                  style={{ top: `${segment.topPercent}%`, height: `${segment.heightPercent}%` }}
                  onClick={() => canManage && onCreateSlot({ startAt: gap.startAt, endAt: gap.endAt })}
                />
              ))}

              {drag && drag.kind === "create" && drag.dayIndex === dayIndex && (
                <div
                  className="chain-watch-timeline__ghost"
                  style={{
                    top: `${(Math.min(drag.anchorMinutes, drag.currentMinutes) / 1_440) * 100}%`,
                    height: `${(Math.abs(drag.currentMinutes - drag.anchorMinutes) / 1_440) * 100}%`,
                  }}
                />
              )}

              {slotSegments.filter((item) => item.segment.dayIndex === dayIndex).map(({ slot, segment }) => {
                const isResizingThis = drag?.kind === "resize" && drag.slotId === slot.id && drag.dayIndex === dayIndex;
                const top = isResizingThis && drag.edge === "start" ? (drag.currentMinutes / 1_440) * 100 : segment.topPercent;
                const bottom = isResizingThis && drag.edge === "end" ? (drag.currentMinutes / 1_440) * 100 : segment.topPercent + segment.heightPercent;
                const rotationId = slot.rotationId;
                return (
                  <div
                    key={`${slot.id}-${segment.dayIndex}`}
                    className={`chain-watch-timeline__block${pendingSlotId === slot.id ? " chain-watch-timeline__block--pending" : ""}`}
                    style={{ top: `${top}%`, height: `${Math.max(0, bottom - top)}%` }}
                    onClick={() => {
                      if (justResizedRef.current) { justResizedRef.current = false; return; }
                      onEditSlot(slot);
                    }}
                  >
                    {canManage && <div className="chain-watch-timeline__handle chain-watch-timeline__handle--top" onPointerDown={(event) => beginResize(slot, "start", dayIndex, event)} />}
                    <div className="chain-watch-timeline__block-body">
                      <strong>{slot.primaryMemberName}</strong>
                      <span>{formatHm(slot.startAt)}–{formatHm(slot.endAt)}</span>
                      {rotationId && <button type="button" className="chain-watch-rotation-badge" onClick={(event) => { event.stopPropagation(); onOpenRotation(rotationId); }} aria-label="Generated by a rotation"><Repeat size={10} /></button>}
                    </div>
                    {canManage && <div className="chain-watch-timeline__handle chain-watch-timeline__handle--bottom" onPointerDown={(event) => beginResize(slot, "end", dayIndex, event)} />}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatHm(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso));
}

function formatWeekRange(weekStartMs: number): string {
  const start = new Date(weekStartMs);
  const end = new Date(weekStartMs + 6 * DAY_MS);
  const formatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  return `${formatter.format(start)} – ${formatter.format(end)} TCT`;
}
