"use client";

import { AlarmClock, CalendarClock, CalendarPlus, Clock3, Pause, Pencil, Play, Repeat, Settings2, ShieldAlert, ShieldCheck, Trash2, TriangleAlert, UserRoundCheck, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createChainWatchSlotAction, deleteChainWatchSlotAction, updateChainWatchSettingsAction, updateChainWatchSlotAction } from "@/app/(platform)/chain-watch/actions";
import { createChainWatchRotationAction, deleteChainWatchRotationAction, pauseChainWatchRotationAction, updateChainWatchRotationAction } from "@/app/(platform)/chain-watch/rotation-actions";
import { ChainHero } from "@/components/chain/chain-hero";
import { ChainWatchRotationDialog } from "@/components/chain/chain-watch-rotation-dialog";
import { Dialog } from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { PageHeader } from "@/components/ui/page-header";
import { TornUserName } from "@/components/ui/torn-user-link";
import { findChainWatchConflicts, type ChainWatchConflict } from "@/lib/chain-watch/chain-watch-conflicts";
import { findChainWatchGaps } from "@/lib/chain-watch/chain-watch-gaps";
import { findActiveSlot, findNextSlot, slotStatus } from "@/lib/chain-watch/chain-watch-schedule";
import type { ChainWatchRotation, ChainWatchRotationInput } from "@/lib/chain-watch/chain-watch-rotation-store";
import type { ChainWatchSlot, ChainWatchWorkspace as ChainWatchWorkspaceData } from "@/lib/chain-watch/chain-watch-store";
import { notify } from "@/lib/client-actions";
import type { TornDataResult, TornRosterMember } from "@/lib/torn/workspace-types";

/** How far ahead the coverage-gap panel looks -- long enough to plan around, short enough to stay actionable. */
const GAP_LOOKAHEAD_MS = 72 * 60 * 60 * 1_000;

interface SlotDraft {
  startAt: string;
  endAt: string;
  primaryTornUserId: string;
  backupTornUserId: string;
  note: string;
}

const EMPTY_DRAFT: SlotDraft = { startAt: "", endAt: "", primaryTornUserId: "", backupTornUserId: "", note: "" };

export function ChainWatchWorkspace({
  workspace,
  rosterResult,
  rotations,
  canManage,
}: {
  workspace: ChainWatchWorkspaceData;
  rosterResult: TornDataResult<TornRosterMember[]>;
  rotations: ChainWatchRotation[];
  canManage: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roleNameDraft, setRoleNameDraft] = useState(workspace.roleName);
  const [bufferDraft, setBufferDraft] = useState(workspace.bufferSeconds);

  const [slotDialog, setSlotDialog] = useState<{ mode: "create" | "edit"; slotId?: string } | null>(null);
  const [draft, setDraft] = useState<SlotDraft>(EMPTY_DRAFT);
  const [deleteTarget, setDeleteTarget] = useState<ChainWatchSlot | null>(null);

  const [rotationDialogOpen, setRotationDialogOpen] = useState(false);
  const [editingRotationId, setEditingRotationId] = useState<string | null>(null);
  const [deleteRotationTarget, setDeleteRotationTarget] = useState<ChainWatchRotation | null>(null);
  const editingRotation = editingRotationId ? rotations.find((rotation) => rotation.id === editingRotationId) ?? null : null;

  const sortedRoster = useMemo(() => [...rosterResult.data].toSorted((left, right) => left.name.localeCompare(right.name)), [rosterResult.data]);

  const upcomingSlots = useMemo(
    () => workspace.slots.filter((slot) => slotStatus(slot, now) !== "past"),
    [workspace.slots, now],
  );
  const pastSlots = useMemo(
    () => workspace.slots.filter((slot) => slotStatus(slot, now) === "past").toReversed(),
    [workspace.slots, now],
  );
  const activeSlot = useMemo(() => findActiveSlot(workspace.slots, now), [workspace.slots, now]);
  const nextSlot = useMemo(() => findNextSlot(workspace.slots, now), [workspace.slots, now]);
  const gaps = useMemo(() => findChainWatchGaps(workspace.slots, now, GAP_LOOKAHEAD_MS), [workspace.slots, now]);

  function openCreate(prefill?: { startAt: string; endAt: string }) {
    setDraft(prefill ? { ...EMPTY_DRAFT, startAt: toLocalInputValue(prefill.startAt), endAt: toLocalInputValue(prefill.endAt) } : EMPTY_DRAFT);
    setSlotDialog({ mode: "create" });
  }

  function openEdit(slot: ChainWatchSlot) {
    setDraft({
      startAt: toLocalInputValue(slot.startAt),
      endAt: toLocalInputValue(slot.endAt),
      primaryTornUserId: String(slot.primaryTornUserId),
      backupTornUserId: slot.backupTornUserId != null ? String(slot.backupTornUserId) : "",
      note: slot.note ?? "",
    });
    setSlotDialog({ mode: "edit", slotId: slot.id });
  }

  async function saveSettings() {
    const result = await updateChainWatchSettingsAction({ roleName: roleNameDraft.trim(), bufferSeconds: bufferDraft });
    notify({ title: result.ok ? "Settings saved" : "Settings not saved", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
  }

  async function saveSlot() {
    const payload = {
      startAt: fromLocalInputValue(draft.startAt),
      endAt: fromLocalInputValue(draft.endAt),
      primaryTornUserId: Number(draft.primaryTornUserId),
      backupTornUserId: draft.backupTornUserId ? Number(draft.backupTornUserId) : null,
      note: draft.note.trim() || null,
    };
    const result = slotDialog?.mode === "edit" && slotDialog.slotId
      ? await updateChainWatchSlotAction({ slotId: slotDialog.slotId, ...payload })
      : await createChainWatchSlotAction(payload);
    notify({ title: result.ok ? "Schedule updated" : "Slot not saved", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const result = await deleteChainWatchSlotAction({ slotId: deleteTarget.id });
    notify({ title: result.ok ? "Slot removed" : "Slot not removed", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
  }

  function openCreateRotation() {
    setEditingRotationId(null);
    setRotationDialogOpen(true);
  }

  function openEditRotation(rotationId: string) {
    setEditingRotationId(rotationId);
    setRotationDialogOpen(true);
  }

  async function saveRotation(input: ChainWatchRotationInput) {
    const result = editingRotationId
      ? await updateChainWatchRotationAction({ rotationId: editingRotationId, ...input })
      : await createChainWatchRotationAction(input);
    notify({ title: result.ok ? "Rotation saved" : "Rotation not saved", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
    setRotationDialogOpen(false);
  }

  async function confirmDeleteRotation() {
    if (!deleteRotationTarget) return;
    const result = await deleteChainWatchRotationAction({ rotationId: deleteRotationTarget.id });
    notify({ title: result.ok ? "Rotation removed" : "Rotation not removed", description: result.message, tone: result.ok ? "success" : "danger" });
    if (!result.ok) throw new Error(result.message);
  }

  async function togglePauseRotation(rotation: ChainWatchRotation) {
    const result = await pauseChainWatchRotationAction({ rotationId: rotation.id, isPaused: !rotation.isPaused });
    notify({ title: result.ok ? "Rotation updated" : "Could not update rotation", description: result.message, tone: result.ok ? "success" : "danger" });
  }

  const manuallyAdjustedFutureCount = useMemo(() => {
    if (!editingRotationId) return 0;
    return workspace.slots.filter((slot) => slot.rotationId === editingRotationId && Date.parse(slot.startAt) > now && slot.updatedAt !== slot.createdAt).length;
  }, [workspace.slots, editingRotationId, now]);

  const draftEndValid = draft.startAt && draft.endAt && fromLocalInputValue(draft.endAt) > fromLocalInputValue(draft.startAt);
  const draftConflicts = useMemo(() => {
    if (!draft.startAt || !draft.endAt || !draftEndValid || !draft.primaryTornUserId) return [];
    return findChainWatchConflicts(workspace.slots, {
      startAt: fromLocalInputValue(draft.startAt),
      endAt: fromLocalInputValue(draft.endAt),
      primaryTornUserId: Number(draft.primaryTornUserId),
      backupTornUserId: draft.backupTornUserId ? Number(draft.backupTornUserId) : null,
      excludeSlotId: slotDialog?.mode === "edit" ? slotDialog.slotId : undefined,
    });
  }, [draft, draftEndValid, workspace.slots, slotDialog]);
  const [firstDraftConflict] = draftConflicts;
  const slotFormValid = Boolean(draft.startAt && draft.endAt && draft.primaryTornUserId && draftEndValid && draft.primaryTornUserId !== draft.backupTornUserId && draftConflicts.length === 0);

  return (
    <div className="page-stack chain-watch-page">
      <PageHeader
        eyebrow="Chain operations"
        title={`${workspace.roleName} schedule`}
        description={`Plan who keeps the chain alive and when. Times are shown in Torn City Time (UTC)${canManage ? "." : " — ask an administrator for edit access."}`}
        actions={canManage ? <>
          <button className="button button--secondary" type="button" onClick={() => { setRoleNameDraft(workspace.roleName); setBufferDraft(workspace.bufferSeconds); setSettingsOpen(true); }}><Settings2 size={15} /> Customize</button>
          <button className="button button--secondary" type="button" onClick={openCreateRotation}><Repeat size={15} /> New rotation</button>
          <button className="button button--primary" type="button" onClick={() => openCreate()}><CalendarPlus size={15} /> Add slot</button>
        </> : undefined}
      />

      <ChainHero />

      <section className={`chain-watch-duty panel${activeSlot ? " chain-watch-duty--covered" : " chain-watch-duty--gap"}`}>
        <span className="chain-watch-duty__mark">{activeSlot ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}</span>
        <div className="chain-watch-duty__body">
          <p className="eyebrow">On duty now</p>
          {activeSlot ? (
            <>
              <div className="chain-watch-duty__people">
                <div><MemberAvatar name={activeSlot.primaryMemberName} /><TornUserName name={activeSlot.primaryMemberName} tornUserId={activeSlot.primaryTornUserId} detail={`${workspace.roleName} · until ${formatTime(activeSlot.endAt)}`} /></div>
                {activeSlot.backupMemberName && activeSlot.backupTornUserId && (
                  <div className="chain-watch-duty__backup"><MemberAvatar name={activeSlot.backupMemberName} size="small" /><TornUserName name={activeSlot.backupMemberName} tornUserId={activeSlot.backupTornUserId} detail="Backup" /></div>
                )}
              </div>
              {activeSlot.note && <p className="chain-watch-duty__note">{activeSlot.note}</p>}
            </>
          ) : (
            <p className="chain-watch-duty__empty">Nobody is scheduled right now. {nextSlot ? `${nextSlot.primaryMemberName} starts at ${formatTime(nextSlot.startAt)}.` : "Add a slot to cover this window."}</p>
          )}
        </div>
        <div className="chain-watch-duty__buffer"><AlarmClock size={15} /><span>Call for a hit under</span><strong>{formatSeconds(workspace.bufferSeconds)}</strong></div>
      </section>

      {gaps.length > 0 && (
        <section className="chain-watch-gaps panel" aria-label="Upcoming coverage gaps">
          <header className="chain-watch-gaps__header"><TriangleAlert size={15} /><span>{gaps.length === 1 ? "1 uncovered window" : `${gaps.length} uncovered windows`} in the next {Math.round(GAP_LOOKAHEAD_MS / 3_600_000)}h</span></header>
          <div className="chain-watch-gaps__list">
            {gaps.map((gap) => (
              <div className="chain-watch-gaps__row" key={`${gap.startAt}-${gap.endAt}`}>
                <span>{formatTime(gap.startAt)} → {formatTime(gap.endAt)}</span>
                {canManage && <button className="button button--secondary" type="button" onClick={() => openCreate(gap)}>Cover this gap</button>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="chain-watch-list panel">
        <header className="chain-watch-list__header">
          <span><CalendarClock size={17} /></span>
          <div><p className="eyebrow">Coverage plan</p><h2>Upcoming &amp; active slots</h2></div>
          <p>{workspace.slots.length ? workspace.message : "Verified faction members only."}</p>
        </header>

        {!workspace.databaseAvailable && <div className="chain-watch-alert chain-watch-alert--danger"><ShieldAlert size={16} /><span>{workspace.message}</span></div>}
        {!rosterResult.available && <div className="chain-watch-alert"><Clock3 size={16} /><span>Roster verification unavailable — scheduling is disabled until Torn confirms current membership.</span></div>}

        <div className="chain-watch-slots" role="list">
          {upcomingSlots.map((slot) => (
            <SlotRow key={slot.id} slot={slot} status={slotStatus(slot, now)} roleName={workspace.roleName} canManage={canManage} onEdit={() => openEdit(slot)} onOpenRotation={openEditRotation} onDelete={() => setDeleteTarget(slot)} />
          ))}
          {upcomingSlots.length === 0 && (
            <div className="chain-watch-empty">
              <Users size={22} />
              <strong>No upcoming coverage scheduled</strong>
              <p>Add a slot for each stretch of the chain someone needs to own — overnight coverage matters most.</p>
            </div>
          )}
        </div>

        {pastSlots.length > 0 && (
          <details className="chain-watch-history">
            <summary>Past slots <span>{pastSlots.length}</span></summary>
            <div className="chain-watch-slots">
              {pastSlots.map((slot) => <SlotRow key={slot.id} slot={slot} status="past" roleName={workspace.roleName} canManage={canManage} onEdit={() => openEdit(slot)} onOpenRotation={openEditRotation} onDelete={() => setDeleteTarget(slot)} />)}
            </div>
          </details>
        )}
      </section>

      {rotations.length > 0 && (
        <section className="chain-watch-list panel">
          <header className="chain-watch-list__header">
            <span><Repeat size={17} /></span>
            <div><p className="eyebrow">Automation</p><h2>Recurring rotations</h2></div>
            <p>Repeats automatically -- generated slots appear above.</p>
          </header>
          <div className="chain-watch-rotations" role="list">
            {rotations.map((rotation) => (
              <RotationRow key={rotation.id} rotation={rotation} canManage={canManage} onEdit={() => openEditRotation(rotation.id)} onTogglePause={() => togglePauseRotation(rotation)} onDelete={() => setDeleteRotationTarget(rotation)} />
            ))}
          </div>
        </section>
      )}

      <Dialog
        open={settingsOpen}
        className="dialog--chain-watch-settings"
        title="Customize the coverage duty"
        description="Rename the role and set when the schedule should flag urgency."
        confirmLabel="Save settings"
        confirmDisabled={!roleNameDraft.trim() || bufferDraft < 15 || bufferDraft > 280}
        onConfirm={saveSettings}
        onClose={() => setSettingsOpen(false)}
      >
        <div className="chain-watch-settings-form">
          <label><span>Role name</span><input value={roleNameDraft} onChange={(event) => setRoleNameDraft(event.target.value)} maxLength={40} placeholder="Chain Watcher" /><small>Shown everywhere this duty appears — try &ldquo;Night Guard&rdquo; or &ldquo;Timer Duty&rdquo;.</small></label>
          <label><span>Alert buffer</span><input type="number" min={15} max={280} step={5} value={bufferDraft} onChange={(event) => setBufferDraft(Number(event.target.value))} /><small>Call for a hit once the chain timer drops below {formatSeconds(bufferDraft)}. Community norm is 1:00–2:00.</small></label>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(slotDialog)}
        className="dialog--chain-watch-slot"
        title={slotDialog?.mode === "edit" ? "Edit coverage slot" : "Add a coverage slot"}
        description="Times are Torn City Time (UTC), matching the chain timer."
        confirmLabel={slotDialog?.mode === "edit" ? "Save changes" : "Add slot"}
        confirmDisabled={!slotFormValid || !rosterResult.available}
        onConfirm={saveSlot}
        onClose={() => setSlotDialog(null)}
      >
        <div className="chain-watch-slot-form">
          <div className="chain-watch-slot-form__times">
            <label><span>Starts</span><input type="datetime-local" value={draft.startAt} onChange={(event) => setDraft((current) => ({ ...current, startAt: event.target.value }))} /></label>
            <label><span>Ends</span><input type="datetime-local" value={draft.endAt} onChange={(event) => setDraft((current) => ({ ...current, endAt: event.target.value }))} /></label>
          </div>
          {draft.startAt && draft.endAt && !draftEndValid && <p className="chain-watch-slot-form__error">The end time must be after the start time.</p>}
          {firstDraftConflict && <p className="chain-watch-slot-form__error">{describeSlotConflict(firstDraftConflict, workspace.slots)}</p>}
          <label><span>Primary — {workspace.roleName}</span>
            <select value={draft.primaryTornUserId} onChange={(event) => setDraft((current) => ({ ...current, primaryTornUserId: event.target.value }))}>
              <option value="">Select a member</option>
              {sortedRoster.map((member) => <option key={member.tornId} value={member.tornId}>{member.name} — {member.position}</option>)}
            </select>
          </label>
          <label><span>Backup <em>(optional)</em></span>
            <select value={draft.backupTornUserId} onChange={(event) => setDraft((current) => ({ ...current, backupTornUserId: event.target.value }))}>
              <option value="">No backup</option>
              {sortedRoster.filter((member) => String(member.tornId) !== draft.primaryTornUserId).map((member) => <option key={member.tornId} value={member.tornId}>{member.name} — {member.position}</option>)}
            </select>
          </label>
          <label><span>Note <em>(optional)</em></span><input value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} maxLength={200} placeholder="e.g. overnight EU coverage" /></label>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        className="dialog--chain-watch-delete"
        title="Remove this coverage slot?"
        description={deleteTarget ? `${deleteTarget.primaryMemberName}'s slot from ${formatTime(deleteTarget.startAt)} to ${formatTime(deleteTarget.endAt)} will be removed.` : undefined}
        confirmLabel="Remove slot"
        destructive
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      >
        <div className="chain-watch-alert chain-watch-alert--danger"><Trash2 size={16} /><span>This cannot be undone. The member can be scheduled again at any time.</span></div>
      </Dialog>

      <ChainWatchRotationDialog
        open={rotationDialogOpen}
        rotation={editingRotation}
        rosterResult={rosterResult}
        manuallyAdjustedFutureCount={manuallyAdjustedFutureCount}
        onSave={saveRotation}
        onClose={() => setRotationDialogOpen(false)}
      />

      <Dialog
        open={Boolean(deleteRotationTarget)}
        className="dialog--chain-watch-delete"
        title="Remove this rotation?"
        description={deleteRotationTarget ? `"${deleteRotationTarget.label}" will stop repeating. Its not-yet-started generated slots will be removed; slots that already started stay as history.` : undefined}
        confirmLabel="Remove rotation"
        destructive
        onConfirm={confirmDeleteRotation}
        onClose={() => setDeleteRotationTarget(null)}
      >
        <div className="chain-watch-alert chain-watch-alert--danger"><Trash2 size={16} /><span>This cannot be undone. A new rotation can be created again at any time.</span></div>
      </Dialog>
    </div>
  );
}

function SlotRow({
  slot,
  status,
  roleName,
  canManage,
  onEdit,
  onOpenRotation,
  onDelete,
}: {
  slot: ChainWatchSlot;
  status: "active" | "upcoming" | "past";
  roleName: string;
  canManage: boolean;
  onEdit: () => void;
  onOpenRotation: (rotationId: string) => void;
  onDelete: () => void;
}) {
  const rotationId = slot.rotationId;
  return (
    <article className={`chain-watch-slot chain-watch-slot--${status}`} role="listitem">
      <div className="chain-watch-slot__time">
        <strong>{formatTime(slot.startAt)}</strong>
        <span>→ {formatTime(slot.endAt)}</span>
      </div>
      <div className="chain-watch-slot__people">
        <div>
          <MemberAvatar name={slot.primaryMemberName} /><TornUserName name={slot.primaryMemberName} tornUserId={slot.primaryTornUserId} detail={roleName} />
          {rotationId && <button className="chain-watch-rotation-badge" type="button" onClick={() => onOpenRotation(rotationId)} aria-label="Generated by a rotation -- open it" title="Generated by a rotation"><Repeat size={11} /></button>}
        </div>
        {slot.backupMemberName && slot.backupTornUserId && <div className="chain-watch-slot__backup"><UserRoundCheck size={13} /><TornUserName name={slot.backupMemberName} tornUserId={slot.backupTornUserId} detail="Backup" /></div>}
        {slot.note && <p className="chain-watch-slot__note">{slot.note}</p>}
      </div>
      <span className={`chain-watch-status chain-watch-status--${status}`}><i />{status === "active" ? "On now" : status === "upcoming" ? "Upcoming" : "Done"}</span>
      {canManage && (
        <div className="chain-watch-slot__actions">
          <button className="icon-button" type="button" onClick={onEdit} aria-label="Edit slot" title="Edit slot"><Pencil size={15} /></button>
          <button className="icon-button icon-button--danger" type="button" onClick={onDelete} aria-label="Remove slot" title="Remove slot"><Trash2 size={15} /></button>
        </div>
      )}
    </article>
  );
}

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function describeWeekdays(mask: number): string {
  if (mask === 0b111_1111) return "Every day";
  if (mask === 0b001_1111) return "Weekdays";
  if (mask === 0b110_0000) return "Weekends";
  return WEEKDAY_SHORT.filter((_, index) => (mask & (1 << index)) !== 0).join(", ") || "No days selected";
}

function describeMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
}

function RotationRow({
  rotation,
  canManage,
  onEdit,
  onTogglePause,
  onDelete,
}: {
  rotation: ChainWatchRotation;
  canManage: boolean;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  return (
    <article className={`chain-watch-rotation-row${rotation.isPaused ? " chain-watch-rotation-row--paused" : ""}`} role="listitem">
      <div className="chain-watch-rotation-row__summary">
        <strong>{rotation.label}</strong>
        <span>{describeWeekdays(rotation.weekdaysMask)} · {describeMinutes(rotation.startMinuteUtc)}–{describeMinutes(rotation.endMinuteUtc)} TCT</span>
      </div>
      <div className="chain-watch-rotation-row__members">
        {rotation.members.length} member{rotation.members.length === 1 ? "" : "s"} rotating
        {rotation.effectiveUntil ? ` · until ${formatTime(rotation.effectiveUntil).replace(" TCT", "")}` : " · no end date"}
      </div>
      {rotation.isPaused && <span className="chain-watch-status chain-watch-status--past"><i />Paused</span>}
      {canManage && (
        <div className="chain-watch-slot__actions">
          <button className="icon-button" type="button" onClick={onTogglePause} aria-label={rotation.isPaused ? "Resume rotation" : "Pause rotation"} title={rotation.isPaused ? "Resume rotation" : "Pause rotation"}>
            {rotation.isPaused ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button className="icon-button" type="button" onClick={onEdit} aria-label="Edit rotation" title="Edit rotation"><Pencil size={15} /></button>
          <button className="icon-button icon-button--danger" type="button" onClick={onDelete} aria-label="Remove rotation" title="Remove rotation"><Trash2 size={15} /></button>
        </div>
      )}
    </article>
  );
}

function formatTime(iso: string): string {
  return `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso))} TCT`;
}

/** `findChainWatchConflicts` already did the real work; this only names who and when for the inline form error. */
function describeSlotConflict(conflict: ChainWatchConflict, slots: readonly ChainWatchSlot[]): string {
  const existing = slots.find((slot) => slot.id === conflict.slotId);
  if (!existing) return "This assignment overlaps another scheduled slot for the same member.";
  const name = (conflict.existingRole === "primary" ? existing.primaryMemberName : existing.backupMemberName) ?? "This member";
  const role = conflict.existingRole === "backup" ? " as backup" : "";
  return `${name} is already scheduled${role} from ${formatTime(existing.startAt)} to ${formatTime(existing.endAt)}.`;
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

/** `datetime-local` inputs are timezone-naive; treated here as Torn City Time
 *  (UTC) to match the chain timer, rather than the viewer's own timezone. */
function fromLocalInputValue(value: string): string {
  return new Date(`${value}:00Z`).toISOString();
}

function toLocalInputValue(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16);
}
