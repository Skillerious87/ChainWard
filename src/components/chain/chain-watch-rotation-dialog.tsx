"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import type { ChainWatchRotation, ChainWatchRotationInput } from "@/lib/chain-watch/chain-watch-rotation-store";
import type { TornRosterMember } from "@/lib/torn/workspace-types";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

interface RotationDraft {
  label: string;
  weekdaysMask: number;
  startTime: string;
  endTime: string;
  memberIds: string[];
  backupTornUserId: string;
  note: string;
  effectiveFrom: string;
  effectiveUntil: string;
  noEndDate: boolean;
}

function draftFromRotation(rotation: ChainWatchRotation | null): RotationDraft {
  if (!rotation) {
    return {
      label: "", weekdaysMask: 0b111_1111, startTime: "22:00", endTime: "06:00",
      memberIds: [], backupTornUserId: "", note: "",
      effectiveFrom: new Date().toISOString().slice(0, 10), effectiveUntil: "", noEndDate: true,
    };
  }
  return {
    label: rotation.label,
    weekdaysMask: rotation.weekdaysMask,
    startTime: minutesToTimeInput(rotation.startMinuteUtc),
    endTime: minutesToTimeInput(rotation.endMinuteUtc),
    memberIds: rotation.members.map((member) => String(member.tornUserId)),
    backupTornUserId: rotation.backupTornUserId != null ? String(rotation.backupTornUserId) : "",
    note: rotation.note ?? "",
    effectiveFrom: rotation.effectiveFrom.slice(0, 10),
    effectiveUntil: rotation.effectiveUntil?.slice(0, 10) ?? "",
    noEndDate: !rotation.effectiveUntil,
  };
}

export function ChainWatchRotationDialog({
  open,
  rotation,
  rosterResult,
  manuallyAdjustedFutureCount,
  onSave,
  onClose,
}: {
  open: boolean;
  rotation: ChainWatchRotation | null;
  rosterResult: { available: boolean; data: TornRosterMember[] };
  manuallyAdjustedFutureCount: number;
  onSave: (input: ChainWatchRotationInput) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<RotationDraft>(() => draftFromRotation(rotation));
  const [resetKey, setResetKey] = useState(rotation?.id ?? "create");

  // Re-seeds the draft when a different rotation opens (or the dialog reopens for "create") without a `useEffect`.
  const currentKey = rotation?.id ?? "create";
  if (currentKey !== resetKey && open) {
    setDraft(draftFromRotation(rotation));
    setResetKey(currentKey);
  }

  const sortedRoster = useMemo(() => [...rosterResult.data].toSorted((left, right) => left.name.localeCompare(right.name)), [rosterResult.data]);
  const rosterById = useMemo(() => new Map(sortedRoster.map((member) => [String(member.tornId), member])), [sortedRoster]);
  const availableToAdd = sortedRoster.filter((member) => !draft.memberIds.includes(String(member.tornId)));
  const availableAsBackup = sortedRoster.filter((member) => !draft.memberIds.includes(String(member.tornId)));

  const startMinutes = timeInputToMinutes(draft.startTime);
  const endMinutes = timeInputToMinutes(draft.endTime);
  const timeValid = draft.startTime && draft.endTime && startMinutes !== endMinutes;
  const dateValid = draft.noEndDate || !draft.effectiveUntil || draft.effectiveUntil >= draft.effectiveFrom;
  const formValid = Boolean(draft.label.trim() && draft.weekdaysMask > 0 && draft.memberIds.length > 0 && timeValid && dateValid && rosterResult.available);

  function addMember(tornId: string) {
    if (!tornId || draft.memberIds.includes(tornId)) return;
    setDraft((current) => ({ ...current, memberIds: [...current.memberIds, tornId], backupTornUserId: current.backupTornUserId === tornId ? "" : current.backupTornUserId }));
  }

  function removeMember(tornId: string) {
    setDraft((current) => ({ ...current, memberIds: current.memberIds.filter((id) => id !== tornId) }));
  }

  function moveMember(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const next = [...current.memberIds];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return { ...current, memberIds: next };
    });
  }

  async function handleSave() {
    await onSave({
      label: draft.label.trim(),
      weekdaysMask: draft.weekdaysMask,
      startMinuteUtc: startMinutes,
      endMinuteUtc: endMinutes,
      members: draft.memberIds.flatMap((id) => {
        const member = rosterById.get(id);
        return member ? [{ tornUserId: member.tornId, memberName: member.name }] : [];
      }),
      backupTornUserId: draft.backupTornUserId ? Number(draft.backupTornUserId) : null,
      backupMemberName: draft.backupTornUserId ? rosterById.get(draft.backupTornUserId)?.name ?? null : null,
      note: draft.note.trim() || null,
      effectiveFrom: draft.effectiveFrom,
      effectiveUntil: draft.noEndDate ? null : draft.effectiveUntil || null,
    });
  }

  return (
    <Dialog
      open={open}
      className="dialog--chain-watch-rotation"
      title={rotation ? "Edit rotation" : "Add a rotation"}
      description="Repeats automatically on the selected days, cycling through the member list one per day. Times are Torn City Time (UTC)."
      confirmLabel={rotation ? "Save changes" : "Create rotation"}
      confirmDisabled={!formValid}
      onConfirm={handleSave}
      onClose={onClose}
    >
      <div className="chain-watch-rotation-form">
        <label><span>Name</span><input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} maxLength={60} placeholder="e.g. Overnight EU coverage" /></label>

        <div>
          <span className="chain-watch-rotation-form__label">Repeats on</span>
          <div className="chain-watch-weekday-picker">
            {WEEKDAY_LABELS.map((day, index) => {
              const bit = 1 << index;
              const active = (draft.weekdaysMask & bit) !== 0;
              return (
                <button
                  key={day}
                  type="button"
                  className={`chain-watch-weekday-picker__day${active ? " chain-watch-weekday-picker__day--active" : ""}`}
                  aria-pressed={active}
                  onClick={() => setDraft((current) => ({ ...current, weekdaysMask: current.weekdaysMask ^ bit }))}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        <div className="chain-watch-slot-form__times">
          <label><span>Starts</span><input type="time" value={draft.startTime} onChange={(event) => setDraft((current) => ({ ...current, startTime: event.target.value }))} /></label>
          <label><span>Ends</span><input type="time" value={draft.endTime} onChange={(event) => setDraft((current) => ({ ...current, endTime: event.target.value }))} /></label>
        </div>
        {draft.startTime && draft.endTime && !timeValid && <p className="chain-watch-slot-form__error">Start and end time cannot be identical.</p>}
        {endMinutes <= startMinutes && draft.startTime && draft.endTime && timeValid && <p className="chain-watch-rotation-form__hint">Crosses midnight -- each instance ends the next day.</p>}

        <div>
          <span className="chain-watch-rotation-form__label">Rotating members <em>(in order)</em></span>
          <select value="" onChange={(event) => addMember(event.target.value)}>
            <option value="">Add a member…</option>
            {availableToAdd.map((member) => <option key={member.tornId} value={member.tornId}>{member.name} — {member.position}</option>)}
          </select>
          <ol className="chain-watch-rotation-members">
            {draft.memberIds.map((id, index) => {
              const member = rosterById.get(id);
              return (
                <li key={id}>
                  <span className="chain-watch-rotation-members__index">{index + 1}</span>
                  <span className="chain-watch-rotation-members__name">{member?.name ?? `Torn ID ${id}`}</span>
                  <button type="button" className="icon-button" disabled={index === 0} onClick={() => moveMember(index, -1)} aria-label="Move up"><ChevronUp size={14} /></button>
                  <button type="button" className="icon-button" disabled={index === draft.memberIds.length - 1} onClick={() => moveMember(index, 1)} aria-label="Move down"><ChevronDown size={14} /></button>
                  <button type="button" className="icon-button icon-button--danger" onClick={() => removeMember(id)} aria-label="Remove"><X size={14} /></button>
                </li>
              );
            })}
            {draft.memberIds.length === 0 && <li className="chain-watch-rotation-members__empty">No members added yet.</li>}
          </ol>
        </div>

        <label><span>Backup <em>(optional, fixed for every instance)</em></span>
          <select value={draft.backupTornUserId} onChange={(event) => setDraft((current) => ({ ...current, backupTornUserId: event.target.value }))}>
            <option value="">No backup</option>
            {availableAsBackup.map((member) => <option key={member.tornId} value={member.tornId}>{member.name} — {member.position}</option>)}
          </select>
        </label>

        <label><span>Note <em>(optional)</em></span><input value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} maxLength={200} placeholder="Shown on every generated slot" /></label>

        <div className="chain-watch-slot-form__times">
          <label><span>Starts on</span><input type="date" value={draft.effectiveFrom} onChange={(event) => setDraft((current) => ({ ...current, effectiveFrom: event.target.value }))} /></label>
          <label>
            <span>Ends on</span>
            <input type="date" value={draft.effectiveUntil} disabled={draft.noEndDate} onChange={(event) => setDraft((current) => ({ ...current, effectiveUntil: event.target.value }))} />
          </label>
        </div>
        <label className="chain-watch-rotation-form__checkbox">
          <input type="checkbox" checked={draft.noEndDate} onChange={(event) => setDraft((current) => ({ ...current, noEndDate: event.target.checked }))} />
          <span>No end date -- keep repeating indefinitely</span>
        </label>
        {!dateValid && <p className="chain-watch-slot-form__error">The end date must be on or after the start date.</p>}

        {manuallyAdjustedFutureCount > 0 && (
          <p className="chain-watch-alert">
            {manuallyAdjustedFutureCount} upcoming slot{manuallyAdjustedFutureCount === 1 ? "" : "s"} {manuallyAdjustedFutureCount === 1 ? "was" : "were"} hand-adjusted after being generated -- saving resets {manuallyAdjustedFutureCount === 1 ? "it" : "them"} to match this pattern.
          </p>
        )}
      </div>
    </Dialog>
  );
}

function minutesToTimeInput(minutes: number): string {
  return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
}

function timeInputToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}
