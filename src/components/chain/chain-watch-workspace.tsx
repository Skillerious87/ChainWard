"use client";

import { AlarmClock, CalendarClock, CalendarPlus, Clock3, Pencil, Settings2, ShieldAlert, ShieldCheck, Trash2, UserRoundCheck, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createChainWatchSlotAction, deleteChainWatchSlotAction, updateChainWatchSettingsAction, updateChainWatchSlotAction } from "@/app/(platform)/chain-watch/actions";
import { ChainHero } from "@/components/chain/chain-hero";
import { Dialog } from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { PageHeader } from "@/components/ui/page-header";
import { TornUserName } from "@/components/ui/torn-user-link";
import { findActiveSlot, findNextSlot, slotStatus } from "@/lib/chain-watch/chain-watch-schedule";
import type { ChainWatchSlot, ChainWatchWorkspace as ChainWatchWorkspaceData } from "@/lib/chain-watch/chain-watch-store";
import { notify } from "@/lib/client-actions";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";
import type { TornDataResult, TornRosterMember } from "@/lib/torn/workspace-types";

interface SlotDraft {
  startAt: string;
  endAt: string;
  primaryTornUserId: string;
  backupTornUserId: string;
  note: string;
}

const EMPTY_DRAFT: SlotDraft = { startAt: "", endAt: "", primaryTornUserId: "", backupTornUserId: "", note: "" };

export function ChainWatchWorkspace({
  telemetry,
  workspace,
  rosterResult,
  canManage,
}: {
  telemetry: WorkspaceTelemetry;
  workspace: ChainWatchWorkspaceData;
  rosterResult: TornDataResult<TornRosterMember[]>;
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

  function openCreate() {
    setDraft(EMPTY_DRAFT);
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

  const draftEndValid = draft.startAt && draft.endAt && fromLocalInputValue(draft.endAt) > fromLocalInputValue(draft.startAt);
  const slotFormValid = Boolean(draft.startAt && draft.endAt && draft.primaryTornUserId && draftEndValid && draft.primaryTornUserId !== draft.backupTornUserId);

  return (
    <div className="page-stack chain-watch-page">
      <PageHeader
        eyebrow="Chain operations"
        title={`${workspace.roleName} schedule`}
        description={`Plan who keeps the chain alive and when. Times are shown in Torn City Time (UTC)${canManage ? "." : " — ask an administrator for edit access."}`}
        actions={canManage ? <>
          <button className="button button--secondary" type="button" onClick={() => { setRoleNameDraft(workspace.roleName); setBufferDraft(workspace.bufferSeconds); setSettingsOpen(true); }}><Settings2 size={15} /> Customize</button>
          <button className="button button--primary" type="button" onClick={openCreate}><CalendarPlus size={15} /> Add slot</button>
        </> : undefined}
      />

      <ChainHero telemetry={telemetry} />

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
            <SlotRow key={slot.id} slot={slot} status={slotStatus(slot, now)} roleName={workspace.roleName} canManage={canManage} onEdit={() => openEdit(slot)} onDelete={() => setDeleteTarget(slot)} />
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
              {pastSlots.map((slot) => <SlotRow key={slot.id} slot={slot} status="past" roleName={workspace.roleName} canManage={canManage} onEdit={() => openEdit(slot)} onDelete={() => setDeleteTarget(slot)} />)}
            </div>
          </details>
        )}
      </section>

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
    </div>
  );
}

function SlotRow({
  slot,
  status,
  roleName,
  canManage,
  onEdit,
  onDelete,
}: {
  slot: ChainWatchSlot;
  status: "active" | "upcoming" | "past";
  roleName: string;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className={`chain-watch-slot chain-watch-slot--${status}`} role="listitem">
      <div className="chain-watch-slot__time">
        <strong>{formatTime(slot.startAt)}</strong>
        <span>→ {formatTime(slot.endAt)}</span>
      </div>
      <div className="chain-watch-slot__people">
        <div><MemberAvatar name={slot.primaryMemberName} /><TornUserName name={slot.primaryMemberName} tornUserId={slot.primaryTornUserId} detail={roleName} /></div>
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

function formatTime(iso: string): string {
  return `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso))} TCT`;
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
