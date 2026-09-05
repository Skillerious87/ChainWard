/**
 * Pure overlap + shared-member detection, kept free of "server-only" so both
 * the create/update actions and the client workspace (for an inline
 * pre-check before submit) can share one definition of "this collides".
 */
export interface ChainWatchMemberWindow {
  startAt: string;
  endAt: string;
  primaryTornUserId: number;
  backupTornUserId: number | null;
}

export interface ChainWatchConflict {
  slotId: string;
  tornUserId: number;
  existingRole: "primary" | "backup";
  candidateRole: "primary" | "backup";
}

/** Exclusive-end overlap, matching `slotStatus`'s convention that a slot ending exactly when another starts does not overlap it. */
export function windowsOverlap(
  a: Pick<ChainWatchMemberWindow, "startAt" | "endAt">,
  b: Pick<ChainWatchMemberWindow, "startAt" | "endAt">,
): boolean {
  return Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(b.startAt) < Date.parse(a.endAt);
}

/** Existing slots that overlap `candidate` and share a member (primary or backup, either side). `candidate.excludeSlotId` lets an edit ignore its own prior row. */
export function findChainWatchConflicts<T extends ChainWatchMemberWindow & { id: string }>(
  existingSlots: readonly T[],
  candidate: ChainWatchMemberWindow & { excludeSlotId?: string },
): ChainWatchConflict[] {
  const conflicts: ChainWatchConflict[] = [];
  for (const existing of existingSlots) {
    if (existing.id === candidate.excludeSlotId) continue;
    if (!windowsOverlap(existing, candidate)) continue;

    if (existing.primaryTornUserId === candidate.primaryTornUserId) {
      conflicts.push({ slotId: existing.id, tornUserId: existing.primaryTornUserId, existingRole: "primary", candidateRole: "primary" });
    }
    if (existing.backupTornUserId != null && existing.backupTornUserId === candidate.primaryTornUserId) {
      conflicts.push({ slotId: existing.id, tornUserId: existing.backupTornUserId, existingRole: "backup", candidateRole: "primary" });
    }
    if (candidate.backupTornUserId != null && candidate.backupTornUserId === existing.primaryTornUserId) {
      conflicts.push({ slotId: existing.id, tornUserId: existing.primaryTornUserId, existingRole: "primary", candidateRole: "backup" });
    }
    if (candidate.backupTornUserId != null && existing.backupTornUserId != null && candidate.backupTornUserId === existing.backupTornUserId) {
      conflicts.push({ slotId: existing.id, tornUserId: existing.backupTornUserId, existingRole: "backup", candidateRole: "backup" });
    }
  }
  return conflicts;
}
