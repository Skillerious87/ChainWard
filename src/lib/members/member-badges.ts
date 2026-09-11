export const AWARD_CITATION_MIN = 10;
export const AWARD_CITATION_MAX = 600;
export const AWARD_CATEGORIES = ["Leadership", "Operations", "Community", "Service"] as const;
export type AwardCategory = (typeof AWARD_CATEGORIES)[number];

export const MEMBER_BADGES = [
  { id: "VANGUARD", label: "Vanguard", category: "Leadership", color: "gold", detail: "First to step forward. Last to step back.", criteria: "Recognise a member who took initiative and led by example when the faction needed direction.", prompt: "Describe the moment they stepped forward, the action they took, and its impact on the faction.", template: "{name} stepped forward when the faction needed direction, leading by example and setting the pace for everyone else to follow." },
  { id: "CHAIN_SENTINEL", label: "Chain Sentinel", category: "Operations", color: "ice", detail: "The watch that never wavered.", criteria: "Recognise dependable chain coverage, careful handovers, and the vigilance that kept the chain alive.", prompt: "Name the chain or coverage window, what they protected, and how their reliability made a difference.", template: "{name} held the chain steady through every watch, covering the gaps and handing it over clean so it never broke." },
  { id: "STEADFAST", label: "Steadfast", category: "Service", color: "amber", detail: "Consistency the faction can count on.", criteria: "Recognise sustained reliability across a meaningful period, beyond a single outstanding contribution.", prompt: "Describe their consistent contribution and the period over which they earned this recognition.", template: "{name} has shown the faction consistent, dependable effort over an extended period — the kind of reliability we can always count on." },
  { id: "MENTOR", label: "Mentor", category: "Community", color: "violet", detail: "Building the next generation.", criteria: "Recognise patient coaching, practical guidance, or support that helped another member grow.", prompt: "Describe the guidance they gave and the progress it helped another member make.", template: "{name} took the time to coach and guide another member, turning patience into real progress for the faction." },
  { id: "FACTION_SERVICE", label: "Faction Service", category: "Service", color: "emerald", detail: "Essential work. Lasting impact.", criteria: "Recognise valuable administration, logistics, resources, or other work behind the scenes.", prompt: "Explain the work they contributed and why it mattered to the faction.", template: "{name} put in valuable behind-the-scenes work — the administration, logistics, and resourcing that keep the faction running." },
  { id: "MILESTONE", label: "Milestone", category: "Service", color: "silver", detail: "A moment worth remembering.", criteria: "Recognise a significant faction achievement or personal milestone with a clear, recorded context.", prompt: "Name the milestone, when it was achieved, and why the faction is celebrating it.", template: "{name} reached a milestone worth marking, a moment the faction is proud to record." },
  { id: "FIELD_COMMANDER", label: "Field Commander", category: "Leadership", color: "gold", detail: "Clarity in the heat of the operation.", criteria: "Recognise effective coordination that brought members together and guided an operation to its outcome.", prompt: "Describe the operation, their leadership responsibilities, and what the team achieved.", template: "{name} coordinated the team through a demanding operation, bringing clarity and direction when it mattered most." },
  { id: "STRATEGIST", label: "Strategist", category: "Leadership", color: "silver", detail: "The thinking behind the advantage.", criteria: "Recognise thoughtful planning, analysis, or an improvement that made the faction more effective.", prompt: "Explain their plan or insight and the practical difference it made.", template: "{name}'s planning and insight gave the faction a real edge, turning a good idea into a practical advantage." },
  { id: "CLUTCH_SAVE", label: "Clutch Save", category: "Operations", color: "amber", detail: "The right action. The critical moment.", criteria: "Recognise a timely intervention that rescued a chain or prevented an operational setback.", prompt: "Record what was at risk, when they intervened, and the outcome of their action.", template: "{name} stepped in at the critical moment and turned a looming setback into a save the faction won't forget." },
  { id: "WAR_DISTINCTION", label: "War Distinction", category: "Operations", color: "ruby", detail: "Outstanding when it mattered most.", criteria: "Recognise an exceptional contribution to a faction war, with specific actions and context.", prompt: "Identify the war and the contribution that deserves special recognition.", template: "{name} delivered an outstanding contribution during a faction war, going above and beyond when the stakes were highest." },
  { id: "LIFELINE", label: "Lifeline", category: "Community", color: "emerald", detail: "There when a member needed them.", criteria: "Recognise meaningful practical help, resources, or support given to a fellow faction member.", prompt: "Describe the help they provided and its impact, respecting the recipient's privacy.", template: "{name} was there for a fellow member when it counted, offering real, practical help without being asked twice." },
  { id: "TEAM_SPIRIT", label: "Team Spirit", category: "Community", color: "violet", detail: "Making the faction feel like home.", criteria: "Recognise someone who strengthened morale, welcomed others, or brought the community together.", prompt: "Describe how they brought members together or made the faction a better place to belong.", template: "{name} brings people together and makes the faction feel like a genuine community, not just a roster." },
] as const;

export type MemberBadgeId = (typeof MEMBER_BADGES)[number]["id"];

export function isMemberBadgeId(value: unknown): value is MemberBadgeId {
  return MEMBER_BADGES.some((badge) => badge.id === value);
}

export function memberBadgeDefinition(id: MemberBadgeId) {
  return MEMBER_BADGES.find((badge) => badge.id === id)!;
}

/** Ready-to-send wording for a badge, personalised with the recipient's name — so an award never requires typing. */
export function renderAwardTemplate(id: MemberBadgeId, recipientName: string): string {
  return memberBadgeDefinition(id).template.replaceAll("{name}", recipientName);
}

export function awardCitationError(value: string): string | null {
  const length = value.trim().length;
  if (length < AWARD_CITATION_MIN) return `Add at least ${AWARD_CITATION_MIN} characters describing the contribution.`;
  if (length > AWARD_CITATION_MAX) return `Keep the citation within ${AWARD_CITATION_MAX} characters.`;
  return null;
}
