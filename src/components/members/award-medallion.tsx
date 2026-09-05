import { BookOpen, Compass, Crown, Flag, Flame, HeartHandshake, ShieldCheck, Sparkles, Swords, Target, Trophy, Users } from "lucide-react";
import { memberBadgeDefinition, type MemberBadgeId } from "@/lib/members/member-badges";

const icons = {
  VANGUARD: Crown, CHAIN_SENTINEL: ShieldCheck, STEADFAST: Flame, MENTOR: BookOpen,
  FACTION_SERVICE: Flag, MILESTONE: Trophy, FIELD_COMMANDER: Compass, STRATEGIST: Target,
  CLUTCH_SAVE: Sparkles, WAR_DISTINCTION: Swords, LIFELINE: HeartHandshake, TEAM_SPIRIT: Users,
} satisfies Record<MemberBadgeId, typeof Crown>;

/** Vector and CSS artwork stays sharp at catalogue, certificate, and card sizes. */
export function AwardMedallion({ badgeId, size = "small" }: { badgeId: MemberBadgeId; size?: "small" | "medium" | "hero" }) {
  const badge = memberBadgeDefinition(badgeId);
  const Icon = icons[badgeId];
  return <span className={`award-medallion award-medallion--${size} award-color--${badge.color}`} aria-hidden="true">
    <span className="award-medallion__ribbons"><i /><i /></span>
    <span className="award-medallion__rim"><span className="award-medallion__face">
      <svg className="award-medallion__laurel" viewBox="0 0 100 100" fill="none">
        <path d="M43 83C13 73 10 39 27 22M57 83C87 73 90 39 73 22" stroke="currentColor" strokeWidth="1.6" />
        {[0, 1, 2, 3, 4].map((leaf) => <g key={leaf} transform={`rotate(${leaf * 16} 50 50)`}><ellipse cx="17" cy="48" rx="2.7" ry="6" transform="rotate(-40 17 48)" fill="currentColor" /><ellipse cx="24" cy="49" rx="2.4" ry="5" transform="rotate(32 24 49)" fill="currentColor" /></g>)}
        {[0, 1, 2, 3, 4].map((leaf) => <g key={leaf} transform={`rotate(${-leaf * 16} 50 50)`}><ellipse cx="83" cy="48" rx="2.7" ry="6" transform="rotate(40 83 48)" fill="currentColor" /><ellipse cx="76" cy="49" rx="2.4" ry="5" transform="rotate(-32 76 49)" fill="currentColor" /></g>)}
      </svg>
      <Icon className="award-medallion__symbol" strokeWidth={1.65} />
      <span className="award-medallion__star">✦</span>
    </span></span>
  </span>;
}
