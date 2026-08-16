import { roleDefinitions, type PermissionDescriptor } from "./authorization";
import type { FactionAccessAssignment, ManagedAccessStatus, ManagedFactionRole } from "./faction-access-store";

export interface AccessDraft {
  role: ManagedFactionRole;
  status: ManagedAccessStatus;
}

export interface AccessChangeImpact {
  changed: boolean;
  tone: "neutral" | "positive" | "warning" | "danger";
  title: string;
  detail: string;
  gained: readonly PermissionDescriptor[];
  removed: readonly PermissionDescriptor[];
}

export interface AccessPosture {
  tone: "healthy" | "review" | "critical";
  title: string;
  detail: string;
  action: "directory" | "assignments" | "roles";
  actionLabel: string;
  staleCount: number;
  suspendedCount: number;
  administratorCount: number;
}

export function analyzeAccessChange(current: AccessDraft | null, next: AccessDraft): AccessChangeImpact {
  if (current?.role === next.role && current.status === next.status) {
    return { changed: false, tone: "neutral", title: "No access change", detail: "The selected role and status already match the saved assignment.", gained: [], removed: [] };
  }

  const before = effectivePermissions(current);
  const after = effectivePermissions(next);
  const gained = after.filter((descriptor) => !before.some((item) => item.permission === descriptor.permission));
  const removed = before.filter((descriptor) => !after.some((item) => item.permission === descriptor.permission));

  if (next.status === "SUSPENDED") {
    return {
      changed: true,
      tone: "warning",
      title: current ? "Access will be suspended" : "Suspended assignment will be recorded",
      detail: current ? "Every active permission is removed immediately while the auditable assignment remains." : "The role is recorded for audit, but it cannot be used until reactivated.",
      gained,
      removed,
    };
  }

  if (!current) {
    return {
      changed: true,
      tone: next.role === "ADMINISTRATOR" ? "danger" : "positive",
      title: next.role === "ADMINISTRATOR" ? "High-trust access will be granted" : "New workspace access will be granted",
      detail: next.role === "ADMINISTRATOR" ? "This role can operate chains, payouts, rewards, members, and backups. Confirm that broad access is required." : "Only the permissions in this role bundle become available.",
      gained,
      removed,
    };
  }

  if (current.status === "SUSPENDED") {
    return {
      changed: true,
      tone: next.role === "ADMINISTRATOR" ? "danger" : "warning",
      title: "Suspended access will be reactivated",
      detail: `${gained.length} permission${gained.length === 1 ? "" : "s"} will become usable again immediately.`,
      gained,
      removed,
    };
  }

  if (gained.length > 0 && removed.length === 0) {
    return { changed: true, tone: next.role === "ADMINISTRATOR" ? "danger" : "warning", title: "This is a privilege increase", detail: `${gained.length} additional permission${gained.length === 1 ? "" : "s"} will become available.`, gained, removed };
  }
  if (removed.length > 0 && gained.length === 0) {
    return { changed: true, tone: "positive", title: "Access will be narrowed", detail: `${removed.length} permission${removed.length === 1 ? "" : "s"} will be removed to enforce least privilege.`, gained, removed };
  }
  return { changed: true, tone: "warning", title: "The permission bundle will change", detail: "Review both the permissions being added and removed before saving.", gained, removed };
}

export function analyzeAccessPosture(
  assignments: readonly FactionAccessAssignment[],
  rosterIds: ReadonlySet<number>,
  rosterAvailable: boolean,
  databaseAvailable: boolean,
): AccessPosture {
  const staleCount = rosterAvailable ? assignments.filter((assignment) => !rosterIds.has(assignment.tornUserId)).length : 0;
  const suspendedCount = assignments.filter((assignment) => assignment.status === "SUSPENDED").length;
  const administratorCount = assignments.filter((assignment) => assignment.status === "ACTIVE" && assignment.role === "ADMINISTRATOR").length;
  const common = { staleCount, suspendedCount, administratorCount };

  if (!databaseAvailable) return { ...common, tone: "critical", title: "Access registry needs storage", detail: "Assignments cannot be managed safely until local or PostgreSQL storage is available.", action: "assignments", actionLabel: "Review registry" };
  if (!rosterAvailable) return { ...common, tone: "review", title: "Roster verification is unavailable", detail: "Existing roles remain visible, but Chainward cannot identify holders who may have left the faction.", action: "directory", actionLabel: "Review roster" };
  if (staleCount > 0) return { ...common, tone: "critical", title: `${staleCount} stale assignment${staleCount === 1 ? "" : "s"} should be revoked`, detail: "These holders are already refused by permission checks; removing their stored rows keeps the registry truthful.", action: "assignments", actionLabel: "Review stale access" };
  if (administratorCount > 2) return { ...common, tone: "review", title: "Broad access deserves a least-privilege review", detail: `${administratorCount} active administrators can operate nearly every faction workflow. Confirm each still needs that breadth.`, action: "roles", actionLabel: "Compare roles" };
  if (suspendedCount > 0) return { ...common, tone: "review", title: `${suspendedCount} suspended assignment${suspendedCount === 1 ? "" : "s"} retained for review`, detail: "Suspended roles cannot be used, but should be reactivated or revoked once the reason is resolved.", action: "assignments", actionLabel: "Review suspended" };
  return { ...common, tone: "healthy", title: "Access posture is clean", detail: "Every assignment belongs to the verified roster and no suspended or stale records need attention.", action: assignments.length ? "roles" : "directory", actionLabel: assignments.length ? "Review role policy" : "Grant least-privilege access" };
}

function effectivePermissions(draft: AccessDraft | null): readonly PermissionDescriptor[] {
  if (!draft || draft.status !== "ACTIVE") return [];
  return roleDefinitions.find((definition) => definition.role === draft.role)?.permissions ?? [];
}
