import type { TornRosterMember } from "@/lib/torn/workspace-types";
import type { CrimeFeed, MemberIntel, OrganizedCrime, RoleObservation } from "./types";

export const STATS_FRESH_MS = 7 * 86_400_000;
export const ROLE_FRESH_MS = 7 * 86_400_000;
export const LIVE_ROLE_FRESH_MS = 15 * 60_000;
export function isFresh(at: string | null, now: number, maxAge: number): boolean {
  if (!at) return false;
  const age = now - Date.parse(at);
  return Number.isFinite(age) && age >= 0 && age <= maxAge;
}

export function collectOwnRoles(crimes: OrganizedCrime[], userId: number, observedAt: string): RoleObservation[] {
  return crimes.flatMap((crime) => crime.slots.flatMap((slot) => {
    // Torn explicitly returns the KEY OWNER's CPR on an empty slot, never everybody's.
    if (crime.status !== "Recruiting" && crime.status !== "Planning") return [];
    if (slot.user !== null && slot.user.id !== userId) return [];
    if (slot.checkpoint_pass_rate === null) return [];
    return [{ crimeId: crime.id, crimeName: crime.name, difficulty: crime.difficulty,
      positionId: String(slot.position_info.id), positionLabel: slot.position_info.label,
      passRate: slot.checkpoint_pass_rate, observedAt }];
  }));
}

export interface RoleSuggestion {
  crimeId: number; crimeName: string; difficulty: number; positionLabel: string;
  passRate: number; evidence: "personal" | "history"; observedAt: string; itemId: number | null;
}
export interface MemberReview {
  member: TornRosterMember; intel: MemberIntel | null; statsFresh: boolean;
  assignment: string | null; suggestions: RoleSuggestion[]; reason: string;
}

/** Conservative shortlist, not a team win-probability model or automatic assignment. */
export function reviewMembers(members: TornRosterMember[], intel: MemberIntel[], live: CrimeFeed, history: CrimeFeed, now: number, minimumCpr = 70): MemberReview[] {
  if (!Number.isFinite(minimumCpr) || minimumCpr < 0 || minimumCpr > 100) throw new Error("CPR threshold must be between 0 and 100.");
  const intelById = new Map(intel.map((record) => [record.tornUserId, record]));
  const liveFresh = live.available && live.complete && isFresh(live.fetchedAt, now, LIVE_ROLE_FRESH_MS);
  const active = live.crimes.filter((crime) => crime.status === "Recruiting" || crime.status === "Planning");
  return members.map((member) => {
    const record = intelById.get(member.tornId) ?? null;
    const assignmentCrime = active.find((crime) => crime.slots.some((slot) => slot.user?.id === member.tornId));
    const assignment = assignmentCrime ? `${assignmentCrime.name} #${assignmentCrime.id}` : null;
    const base = { member, intel: record, statsFresh: isFresh(record?.statsAt ?? null, now, STATS_FRESH_MS), assignment };
    if (!liveFresh) return { ...base, suggestions: [], reason: "Current OC availability is incomplete or unavailable; refresh before recommending." };
    if (assignment) return { ...base, suggestions: [], reason: "Already assigned to an active OC." };
    const suggestions: RoleSuggestion[] = [];
    for (const crime of active) {
      if (crime.status === "Recruiting" && crime.expired_at * 1000 <= now) continue;
      for (const slot of crime.slots) {
        if (slot.user) continue;
        const personal = record?.roles.find((role) => role.crimeId === crime.id
          && role.positionId === String(slot.position_info.id) && role.positionLabel === slot.position_info.label
          && role.crimeName === crime.name && role.difficulty === crime.difficulty
          && isFresh(role.observedAt, now, LIVE_ROLE_FRESH_MS));
        // Match scenario + difficulty + exact role identity; numbered roles are not interchangeable.
        const historical = history.available ? history.crimes
          .filter((past) => past.name === crime.name && past.difficulty === crime.difficulty
            && (past.status === "Successful" || past.status === "Failure") && past.executed_at !== null
            && isFresh(new Date(past.executed_at * 1000).toISOString(), now, ROLE_FRESH_MS))
          .toSorted((a, b) => b.executed_at! - a.executed_at! || b.id - a.id)
          .flatMap((past) => past.slots.filter((s) => s.user?.id === member.tornId
            && String(s.position_info.id) === String(slot.position_info.id) && s.position_info.label === slot.position_info.label
            && s.checkpoint_pass_rate !== null).map((s) => ({ passRate: s.checkpoint_pass_rate!, at: new Date(past.executed_at! * 1000).toISOString() })))[0] : undefined;
        const passRate = personal?.passRate ?? historical?.passRate;
        if (passRate === undefined || passRate < minimumCpr) continue;
        suggestions.push({ crimeId: crime.id, crimeName: crime.name, difficulty: crime.difficulty,
          positionLabel: slot.position_info.label, passRate, evidence: personal ? "personal" : "history",
          observedAt: personal?.observedAt ?? historical!.at, itemId: slot.item_requirement?.id ?? null });
      }
    }
    suggestions.sort((a, b) => Number(b.evidence === "personal") - Number(a.evidence === "personal")
      || b.passRate - a.passRate || b.difficulty - a.difficulty || a.crimeId - b.crimeId || a.positionLabel.localeCompare(b.positionLabel));
    const reason = suggestions.length ? "Ranked by current personal evidence, then CPR, then difficulty. Confirm in Torn before joining."
      : "No recent matching role evidence meets this CPR threshold. Check personal CPR in Torn.";
    return { ...base, suggestions, reason };
  });
}
