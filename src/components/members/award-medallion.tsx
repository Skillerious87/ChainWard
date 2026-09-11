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
  { x: 35.55, y: 79.75, a: -151.0, r: 6.8 },
  { x: 28.26, y: 74.52, a: -137.5, r: 6.35 },
  { x: 22.78, y: 68.16, a: -123.9, r: 5.9 },
  { x: 19.07, y: 60.99, a: -110.9, r: 5.45 },
  { x: 17.06, y: 53.34, a: -98.5, r: 5.0 },
  { x: 16.71, y: 45.51, a: -86.6, r: 4.55 },
  { x: 17.97, y: 37.81, a: -74.9, r: 4.1 },
  { x: 20.76, y: 30.58, a: -62.7, r: 3.65 },
  { x: 25.06, y: 24.12, a: -49.9, r: 3.2 },
] as const;
const LAUREL_SPLAY = 50;

function laurelLeafPath(r: number) {
  const tip = r * 2.1;
  const w = r * 0.3;
  const mid = r * 0.5;
  return `M0 0Q${mid} ${-w} ${tip} 0Q${mid} ${w} 0 0Z`;
}

/** A short centre rib etched into each leaf so the wreath reads as engraved metal, not flat stickers. */
function laurelVeinPath(r: number) {
  return `M${(r * 0.3).toFixed(2)} 0L${(r * 1.9).toFixed(2)} 0`;
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
        <path d="M43 83C13 73 10 39 27 22M57 83C87 73 90 39 73 22" stroke="currentColor" strokeWidth="1.5" />
        {LAUREL_NODES.map(({ x, y, a, r }, i) => <g key={i}>
          <LaurelLeaf x={x} y={y} angle={a - LAUREL_SPLAY} r={r} />
          <LaurelLeaf x={x} y={y} angle={a + LAUREL_SPLAY} r={r} />
          <LaurelLeaf x={100 - x} y={y} angle={180 - a - LAUREL_SPLAY} r={r} />
          <LaurelLeaf x={100 - x} y={y} angle={180 - a + LAUREL_SPLAY} r={r} />
        </g>)}
        {/* A small ribbon band tying both branches together at the base of the wreath. */}
        <rect x="45" y="80.6" width="10" height="3.2" rx="1.6" fill="currentColor" />
        <line x1="50" y1="80.6" x2="50" y2="83.8" stroke="#0c1218" strokeWidth={0.5} opacity={0.5} />
      </svg>
      <Icon className="award-medallion__symbol" strokeWidth={1.65} />
      <svg className="award-medallion__star" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2c.9 5.6 3.4 8.1 9 9-5.6.9-8.1 3.4-9 9-.9-5.6-3.4-8.1-9-9 5.6-.9 8.1-3.4 9-9Z" />
      </svg>
    </span></span>
  </span>;
}
