import { BookOpen, Compass, Crown, Flag, Flame, HeartHandshake, ShieldCheck, Sparkles, Swords, Target, Trophy, Users } from "lucide-react";
import { memberBadgeDefinition, type MemberBadgeId } from "@/lib/members/member-badges";

const icons = {
  VANGUARD: Crown, CHAIN_SENTINEL: ShieldCheck, STEADFAST: Flame, MENTOR: BookOpen,
  FACTION_SERVICE: Flag, MILESTONE: Trophy, FIELD_COMMANDER: Compass, STRATEGIST: Target,
  CLUTCH_SAVE: Sparkles, WAR_DISTINCTION: Swords, LIFELINE: HeartHandshake, TEAM_SPIRIT: Users,
} satisfies Record<MemberBadgeId, typeof Crown>;

/**
 * Points and tangent angles sampled along the left stem's bezier
 * (`M43 83C13 73 10 39 27 22`), so every leaf's base sits exactly on the
 * stem instead of drifting off it. Each leaflet is drawn from its own
 * attachment point at the local origin, so rotation never pulls it away
 * from the curve — see AwardMedallion below.
 */
const LAUREL_NODES = [
  { x: 31.3, y: 77.0, a: -143.6, r: 7.4 },
  { x: 22.3, y: 67.4, a: -122.4, r: 6.8 },
  { x: 17.5, y: 55.8, a: -102.4, r: 6.1 },
  { x: 16.9, y: 43.6, a: -83.8, r: 5.4 },
  { x: 20.1, y: 31.9, a: -65.2, r: 4.6 },
] as const;
const LAUREL_SPLAY = 58;

function laurelLeafPath(r: number) {
  const tip = r * 2;
  const w = r * 0.32;
  const mid = r * 0.55;
  return `M0 0Q${mid} ${-w} ${tip} 0Q${mid} ${w} 0 0Z`;
}

/** A short centre rib etched into each leaf so the wreath reads as engraved metal, not flat stickers. */
function laurelVeinPath(r: number) {
  return `M${(r * 0.35).toFixed(2)} 0L${(r * 1.8).toFixed(2)} 0`;
}

function LaurelLeaf({ x, y, angle, r }: { x: number; y: number; angle: number; r: number }) {
  return <g transform={`translate(${x} ${y}) rotate(${angle})`}>
    <path d={laurelLeafPath(r)} fill="currentColor" />
    <path d={laurelVeinPath(r)} stroke="#00000055" strokeWidth={0.4} strokeLinecap="round" />
  </g>;
}

/** Vector and CSS artwork stays sharp at catalogue, certificate, and card sizes. */
export function AwardMedallion({ badgeId, size = "small" }: { badgeId: MemberBadgeId; size?: "small" | "medium" | "hero" }) {
  const badge = memberBadgeDefinition(badgeId);
  const Icon = icons[badgeId];
  return <span className={`award-medallion award-medallion--${size} award-color--${badge.color}`} aria-hidden="true">
    <span className="award-medallion__ribbons"><i /><i /></span>
    <span className="award-medallion__rim"><span className="award-medallion__face">
      <svg className="award-medallion__laurel" viewBox="0 0 100 100" fill="none">
        <path d="M43 83C13 73 10 39 27 22M57 83C87 73 90 39 73 22" stroke="currentColor" strokeWidth="1.6" />
        {LAUREL_NODES.map(({ x, y, a, r }, i) => <g key={i}>
          <LaurelLeaf x={x} y={y} angle={a - LAUREL_SPLAY} r={r} />
          <LaurelLeaf x={x} y={y} angle={a + LAUREL_SPLAY} r={r} />
          <LaurelLeaf x={100 - x} y={y} angle={180 - a - LAUREL_SPLAY} r={r} />
          <LaurelLeaf x={100 - x} y={y} angle={180 - a + LAUREL_SPLAY} r={r} />
        </g>)}
        {/* The knot where both branches meet, tying the wreath together at its base. */}
        <path d="M43 83Q50 79 57 83Q50 87.5 43 83Z" fill="currentColor" />
        <circle cx="50" cy="83" r="1.6" fill="#0c1218" opacity={0.55} />
      </svg>
      <Icon className="award-medallion__symbol" strokeWidth={1.65} />
      <svg className="award-medallion__star" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2c.9 5.6 3.4 8.1 9 9-5.6.9-8.1 3.4-9 9-.9-5.6-3.4-8.1-9-9 5.6-.9 8.1-3.4 9-9Z" />
      </svg>
    </span></span>
  </span>;
}
