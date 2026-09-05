import { ShieldCheck } from "lucide-react";
import { memberBadgeDefinition } from "@/lib/members/member-badges";
import type { MemberAward } from "@/lib/members/member-profile-store";
import { AwardMedallion } from "./award-medallion";

export function MemberAwardCard({ award, canManage, onRevoke }: { award: MemberAward; canManage: boolean; onRevoke: () => void }) {
  const badge = memberBadgeDefinition(award.badgeId);
  return <article className={`honours-card award-color--${badge.color}`}>
    <header><span>{badge.category}</span><time dateTime={award.awardedAt}>{new Date(award.awardedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</time></header>
    <div className="honours-card__identity"><AwardMedallion badgeId={badge.id} size="medium" /><div><p>FACTION DISTINCTION</p><h3>{badge.label}</h3><small>{badge.detail}</small></div></div>
    <blockquote>{award.citation}</blockquote>
    <footer><span><ShieldCheck size={13} /><span>Awarded by <strong>{award.awardedByName}</strong></span></span>{canManage && <button type="button" onClick={onRevoke} aria-label={`Revoke ${badge.label}`}>Revoke</button>}</footer>
  </article>;
}
