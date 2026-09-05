"use client";

import { Check, ChevronRight, Search, ShieldCheck, Trophy } from "lucide-react";
import { useId, useState } from "react";
import { addMemberAward } from "@/app/(platform)/members/actions";
import { Dialog } from "@/components/ui/dialog";
import { notify } from "@/lib/client-actions";
import { AWARD_CATEGORIES, AWARD_CITATION_MAX, MEMBER_BADGES, awardCitationError, memberBadgeDefinition, type AwardCategory, type MemberBadgeId } from "@/lib/members/member-badges";
import type { MemberAward } from "@/lib/members/member-profile-store";
import { AwardMedallion } from "./award-medallion";

interface AwardDialogProps {
  member: { name: string; tornId: number };
  factionId: number;
  awards: MemberAward[];
  onClose: () => void;
  onSaved: () => void;
}

export function MemberAwardDialog({ member, factionId, awards, onClose, onSaved }: AwardDialogProps) {
  const owned = new Set(awards.filter((award) => !award.revokedAt).map((award) => award.badgeId));
  const [badgeId, setBadgeId] = useState<MemberBadgeId>(() => !owned.has("CHAIN_SENTINEL") ? "CHAIN_SENTINEL" : MEMBER_BADGES.find((badge) => !owned.has(badge.id))?.id ?? "CHAIN_SENTINEL");
  const [category, setCategory] = useState<AwardCategory | "All">("All");
  const [query, setQuery] = useState("");
  const [citation, setCitation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const badge = memberBadgeDefinition(badgeId);
  const citationError = awardCitationError(citation);
  const alreadyAwarded = owned.has(badgeId);
  const allAwarded = MEMBER_BADGES.every((item) => owned.has(item.id));
  const catalogue = MEMBER_BADGES.filter((item) => (category === "All" || item.category === category) && `${item.label} ${item.detail} ${item.criteria}`.toLowerCase().includes(query.trim().toLowerCase()));

  async function saveAward() {
    if (alreadyAwarded || citationError) return;
    setError(null);
    setSaving(true);
    try {
      const result = await addMemberAward({ factionId, tornUserId: member.tornId, badgeId, citation: citation.trim() });
      if (!result.ok) throw new Error(result.message);
      notify({ title: `${badge.label} awarded`, description: `${member.name}'s contribution is now part of their faction record.`, tone: "success" });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The award could not be saved. Your citation is still here; please try again.");
      throw cause;
    } finally {
      setSaving(false);
    }
  }

  return <Dialog open className="dialog--honours" title="Award a distinction" description={`Recognise ${member.name} for a contribution that deserves to be remembered.`} confirmLabel={allAwarded ? "All distinctions awarded" : `Award ${badge.label}`} confirmDisabled={alreadyAwarded || !!citationError} onConfirm={saveAward} onClose={onClose}>
    <div className="honours-composer">
      <fieldset className="honours-composer__editor" disabled={saving}>
        <legend className="sr-only">Award details</legend>
        <div className="honours-step"><span>01</span><h3>Choose the recognition</h3><small>{MEMBER_BADGES.length} distinctions</small></div>
        {allAwarded && <p className="honours-owned-note" role="status">This member already holds every available distinction. Their existing awards remain on their record.</p>}
        <label className="honours-search"><Search size={16} /><input aria-label="Search distinctions" placeholder="Find an award…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="honours-filters" aria-label="Filter awards by category">{(["All", ...AWARD_CATEGORIES] as const).map((item) => <button type="button" key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <fieldset className="honours-catalogue"><legend className="sr-only">Choose an award for {member.name}</legend>
          {catalogue.map((item) => <label key={item.id} className={`honours-option award-color--${item.color}${badgeId === item.id ? " honours-option--selected" : ""}${owned.has(item.id) ? " honours-option--owned" : ""}`}>
            <input type="radio" name={`${id}-badge`} value={item.id} checked={badgeId === item.id} disabled={owned.has(item.id)} onChange={() => { setBadgeId(item.id); setError(null); }} />
            <AwardMedallion badgeId={item.id} />
            <span className="honours-option__copy"><strong>{item.label}</strong><small>{owned.has(item.id) ? "Already on this member's record" : item.detail}</small></span>
            <span className="honours-option__check">{owned.has(item.id) || badgeId === item.id ? <Check size={12} /> : <ChevronRight size={12} />}</span>
          </label>)}
          {!catalogue.length && <div className="honours-search-empty"><Search size={22} /><strong>No matching distinctions</strong><p>Try another search or category.</p><button type="button" onClick={() => { setQuery(""); setCategory("All"); }}>Show all awards</button></div>}
        </fieldset>
        <div className="honours-step honours-step--citation"><span>02</span><h3>Tell their story</h3><small>Required</small></div>
        <label className="honours-citation" htmlFor={`${id}-citation`}>Award citation <span>{citation.trim().length}/{AWARD_CITATION_MAX}</span></label>
        <textarea id={`${id}-citation`} className="honours-citation-input" value={citation} maxLength={AWARD_CITATION_MAX} onBlur={() => setTouched(true)} onChange={(event) => { setCitation(event.target.value); setError(null); }} placeholder={badge.prompt} aria-describedby={`${id}-guidance`} aria-invalid={touched && !!citationError} />
        <p id={`${id}-guidance`} className={`honours-guidance${touched && citationError ? " honours-guidance--error" : ""}`}>{touched && citationError ? citationError : "Be specific: the contribution, the context, and the difference it made."}</p>
        {error && <p className="honours-error" role="alert">{error}</p>}
      </fieldset>
      <aside className={`honours-preview award-color--${badge.color}`} aria-label="Award preview">
        <div className="honours-preview__label"><span /><Trophy size={12} /> Presentation preview<span /></div>
        <div className="honours-certificate">
          <p className="honours-certificate__brand">CHAINWARD <span>FACTION HONOURS</span></p>
          <div className="honours-certificate__art"><AwardMedallion badgeId={badgeId} size="hero" /></div>
          <p className="honours-certificate__category">{badge.category} distinction</p>
          <h3>{badge.label}</h3>
          <div className="honours-certificate__rule"><span />✦<span /></div>
          <p className="honours-certificate__presented">Presented to</p><strong className="honours-certificate__recipient">{member.name}</strong><small className="honours-certificate__id">TORN ID {member.tornId}</small>
          <p className={`honours-certificate__citation${!citation.trim() ? " honours-certificate__citation--placeholder" : ""}`}>{citation.trim() || "Their contribution. In your words. A permanent place in the faction's story."}</p>
          <div className="honours-certificate__seal"><ShieldCheck size={13} /> Faction recognition</div>
        </div>
        <div className="honours-criteria"><h4>What this award recognises</h4><p>{badge.criteria}</p></div>
        <p className="honours-record-note"><ShieldCheck size={15} /><span>Visible to the faction. Your name, the citation, and the award date are kept on the member’s record.</span></p>
        {alreadyAwarded && !allAwarded && <p className="honours-owned-note" role="status"><Check size={14} /> This member already holds this distinction. Choose another award.</p>}
      </aside>
    </div>
    <p className="honours-disclosure">Chainward honours are awarded by faction managers and are separate from Torn achievements.</p>
  </Dialog>;
}
