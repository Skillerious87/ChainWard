export const MEMBER_BADGES = [
  { id: "VANGUARD", label: "Vanguard", detail: "Led from the front when the faction needed it." },
  { id: "CHAIN_SENTINEL", label: "Chain Sentinel", detail: "Delivered dependable chain participation and coverage." },
  { id: "STEADFAST", label: "Steadfast", detail: "Showed sustained reliability over time." },
  { id: "MENTOR", label: "Mentor", detail: "Helped other members learn, improve, or settle in." },
  { id: "FACTION_SERVICE", label: "Faction Service", detail: "Contributed valuable work behind the scenes." },
  { id: "MILESTONE", label: "Milestone", detail: "Reached a faction achievement worth recording." },
] as const;

export type MemberBadgeId = (typeof MEMBER_BADGES)[number]["id"];

export function isMemberBadgeId(value: unknown): value is MemberBadgeId {
  return MEMBER_BADGES.some((badge) => badge.id === value);
}

export function memberBadgeDefinition(id: MemberBadgeId) {
  return MEMBER_BADGES.find((badge) => badge.id === id)!;
}
