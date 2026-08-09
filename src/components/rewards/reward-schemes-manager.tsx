"use client";

import {
  Archive,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Check,
  CircleDollarSign,
  Copy,
  Database,
  FilePlus2,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { saveRewardScheme, setRewardSchemeArchived } from "@/app/(platform)/rewards/actions";
import { InfoTip } from "@/components/ui/info-tip";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/lib/client-actions";
import { validateRewardTiers } from "@/lib/rewards/reward-engine";
import type { RewardSchemeView, RewardTierView, RewardWorkspaceView } from "@/lib/rewards/reward-store";

interface EditableScheme {
  id: string | null;
  name: string;
  description: string;
  version: number;
  isDefault: boolean;
  rewardName: string;
  rewardUnit: string;
  tiers: RewardTierView[];
  lockedByHistory: boolean;
}

export function RewardSchemesManager({ workspace }: { workspace: RewardWorkspaceView }) {
  const router = useRouter();
  const initial = workspace.schemes.find((scheme) => scheme.isDefault && scheme.status === "ACTIVE") ?? workspace.schemes.find((scheme) => scheme.status === "ACTIVE") ?? workspace.schemes[0];
  const [selectedId, setSelectedId] = useState<string | null>(initial?.id ?? null);
  const [draft, setDraft] = useState<EditableScheme | null>(() => initial ? editable(initial) : null);
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const visibleSchemes = workspace.schemes.filter((scheme) => showArchived || scheme.status !== "ARCHIVED");
  const validation = useMemo(() => draft ? validateDraft(draft) : [], [draft]);
  const defaultScheme = workspace.schemes.find((scheme) => scheme.isDefault && scheme.status === "ACTIVE");

  function selectScheme(scheme: RewardSchemeView): void {
    setSelectedId(scheme.id);
    setDraft(editable(scheme));
  }

  function startNew(source?: EditableScheme): void {
    setSelectedId(null);
    setDraft(source ? {
      ...source,
      id: null,
      name: `${source.name} copy`,
      version: 1,
      isDefault: false,
      lockedByHistory: false,
      tiers: source.tiers.map((tier) => ({ ...tier, id: crypto.randomUUID() })),
    } : starterScheme());
  }

  function updateTier(id: string, changes: Partial<RewardTierView>): void {
    setDraft((current) => current ? { ...current, tiers: current.tiers.map((tier) => tier.id === id ? { ...tier, ...changes } : tier) } : current);
  }

  function addTier(): void {
    setDraft((current) => {
      if (!current) return current;
      const tiers = current.tiers.map((tier) => ({ ...tier }));
      const last = tiers.at(-1);
      if (last?.maximumHits === null) last.maximumHits = last.minimumHits + 9;
      const minimumHits = last ? (last.maximumHits ?? last.minimumHits) + 1 : 0;
      return { ...current, tiers: [...tiers, { id: crypto.randomUUID(), label: `Tier ${tiers.length + 1}`, minimumHits, maximumHits: null, amount: last?.amount ?? 0, enabled: true }] };
    });
  }

  function removeTier(id: string): void {
    setDraft((current) => current ? { ...current, tiers: current.tiers.filter((tier) => tier.id !== id) } : current);
  }

  function moveTier(index: number, direction: -1 | 1): void {
    setDraft((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.tiers.length) return current;
      const tiers = [...current.tiers];
      [tiers[index], tiers[target]] = [tiers[target]!, tiers[index]!];
      return { ...current, tiers };
    });
  }

  function normalizeRanges(): void {
    setDraft((current) => {
      if (!current) return current;
      const tiers = current.tiers.toSorted((left, right) => left.minimumHits - right.minimumHits).map((tier, index, sorted) => ({
        ...tier,
        maximumHits: index === sorted.length - 1 ? null : Math.max(tier.minimumHits, sorted[index + 1]!.minimumHits - 1),
      }));
      return { ...current, tiers };
    });
    notify({ title: "Ranges normalized", description: "Enabled tiers now run in ascending order with one unlimited final tier.", tone: "success" });
  }

  async function save(): Promise<void> {
    if (!draft || validation.length || !workspace.databaseAvailable) return;
    setSaving(true);
    try {
      const result = await saveRewardScheme(draft);
      const verb = result.mode === "versioned" ? `Version ${result.version} created` : result.mode === "updated" ? "Scheme updated" : "Scheme created";
      notify({ title: verb, description: "The reward rules are saved in the faction database.", tone: "success" });
      router.refresh();
    } catch (error) {
      notify({ title: "Scheme not saved", description: error instanceof Error ? error.message : "Review the reward rules and try again.", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  async function archive(scheme: RewardSchemeView): Promise<void> {
    try {
      await setRewardSchemeArchived({ id: scheme.id, archived: scheme.status !== "ARCHIVED" });
      notify({ title: scheme.status === "ARCHIVED" ? "Scheme restored" : "Scheme archived", description: `${scheme.name} was updated.`, tone: "success" });
      router.refresh();
    } catch (error) {
      notify({ title: "Scheme not updated", description: error instanceof Error ? error.message : "Try again.", tone: "danger" });
    }
  }

  return <div className="page-stack reward-workspace">
    <PageHeader eyebrow="Reward operations" title="Reward schemes" description="Turn contribution ranges into clear, versioned payout rules for your faction." actions={<button className="button button--primary" onClick={() => startNew()}><Plus size={16} /> New scheme</button>} />

    <section className={`reward-storage-banner reward-storage-banner--${workspace.databaseAvailable ? "ready" : "attention"}`}>
      <span><Database size={18} /></span><div><strong>{workspace.databaseAvailable ? "Reward storage ready" : "Local database setup required"}</strong><p>{workspace.message}</p></div><Link href="/settings">{workspace.databaseAvailable ? "Backup settings" : "Set up storage"} <span>→</span></Link>
    </section>

    <section className="reward-onboarding" aria-label="How reward schemes work">
      <div><span>1</span><p><strong>Choose a scheme</strong><small>Select an existing version or start a guided template.</small></p></div>
      <div><span>2</span><p><strong>Define hit ranges</strong><small>Every enabled tier needs a non-overlapping range and reward.</small></p></div>
      <div><span>3</span><p><strong>Save safely</strong><small>Used schemes create a new version so historical payouts never change.</small></p></div>
    </section>

    <section className="reward-summary-strip">
      <div><small>Saved versions</small><strong>{workspace.schemes.length}</strong><span>Database records</span></div>
      <div><small>Default scheme</small><strong>{defaultScheme?.name ?? "Not set"}</strong><span>{defaultScheme ? `Version ${defaultScheme.version}` : "Choose one before payouts"}</span></div>
      <div><small>Current tier count</small><strong>{draft?.tiers.filter((tier) => tier.enabled).length ?? 0}</strong><span>Enabled ranges</span></div>
      <div><small>Reward unit</small><strong>{draft?.rewardUnit || "Not selected"}</strong><span>Applied per qualifying member</span></div>
    </section>

    <div className="reward-builder-layout">
      <aside className="reward-library">
        <header><div><p className="eyebrow">Scheme library</p><h2>Saved rules</h2></div><span>{visibleSchemes.length}</span></header>
        <button className={`reward-library__new${selectedId === null && draft ? " reward-library__new--active" : ""}`} onClick={() => startNew()}><span><FilePlus2 size={17} /></span><p><strong>New guided scheme</strong><small>Start with six editable hit ranges</small></p></button>
        <div className="reward-library__list">
          {visibleSchemes.map((scheme) => <button key={scheme.id} className={selectedId === scheme.id ? "reward-library__item reward-library__item--active" : "reward-library__item"} onClick={() => selectScheme(scheme)}>
            <span className="scheme-icon">{scheme.name.slice(0, 2).toUpperCase()}</span>
            <p><strong>{scheme.name}</strong><small>Version {scheme.version} · {scheme.tiers.length} tiers</small></p>
            <em className={scheme.status === "ARCHIVED" ? "scheme-state scheme-state--archived" : scheme.isDefault ? "scheme-state scheme-state--default" : "scheme-state"}>{scheme.status === "ARCHIVED" ? "Archived" : scheme.isDefault ? "Default" : "Active"}</em>
          </button>)}
          {visibleSchemes.length === 0 && <div className="reward-library__empty"><CircleDollarSign size={20} /><strong>No saved schemes</strong><small>Create a guided scheme to begin.</small></div>}
        </div>
        {workspace.schemes.some((scheme) => scheme.status === "ARCHIVED") && <button className="reward-library__archive-toggle" onClick={() => setShowArchived((value) => !value)}><Archive size={14} /> {showArchived ? "Hide archived" : "Show archived"}</button>}
      </aside>

      <main className="reward-editor">
        {!draft ? <div className="reward-editor__empty"><span><Sparkles size={24} /></span><h2>Create an understandable payout policy</h2><p>Start with the guided template, then adjust the ranges and reward amounts to match your faction.</p><button className="button button--primary" onClick={() => startNew()}><Plus size={16} /> Start guided setup</button></div> : <>
          <header className="reward-editor__header">
            <div><div className="reward-editor__title"><p className="eyebrow">{draft.id ? `Saved scheme · version ${draft.version}` : "Unsaved scheme"}</p>{draft.lockedByHistory && <span><BadgeCheck size={13} /> History protected</span>}</div><h2>{draft.name || "Untitled reward scheme"}</h2><p>{draft.lockedByHistory ? "Saving changes creates a new version; completed calculations remain unchanged." : "Changes update this version until it is used by a chain or calculation."}</p></div>
            <div className="reward-editor__actions">{draft.id && <><button className="button button--quiet" onClick={() => startNew(draft)}><Copy size={15} /> Duplicate</button><button className="button button--quiet" onClick={() => { const source = workspace.schemes.find((scheme) => scheme.id === draft.id); if (source) void archive(source); }}><Archive size={15} /> Archive</button></>}<button className="button button--primary" disabled={saving || validation.length > 0 || !workspace.databaseAvailable} onClick={() => void save()}><Save size={15} /> {saving ? "Saving…" : draft.lockedByHistory ? "Save new version" : "Save scheme"}</button></div>
          </header>

          <section className="reward-editor__basics">
            <label><span>Scheme name <InfoTip label="About scheme names">Use a name faction leaders will recognize when assigning a scheme to a chain.</InfoTip></span><input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Standard chain rewards" /></label>
            <label><span>Reward item <InfoTip label="About reward items">This is the item or unit granted by every tier. Multiple reward types can be added in a future version.</InfoTip></span><input value={draft.rewardName} maxLength={40} onChange={(event) => setDraft({ ...draft, rewardName: event.target.value, rewardUnit: event.target.value })} placeholder="Xanax" /></label>
            <label className="reward-editor__description"><span>Description</span><input value={draft.description} maxLength={300} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="When should faction leaders use this scheme?" /></label>
            <label className="reward-default-toggle"><input type="checkbox" checked={draft.isDefault} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} /><span><Check size={13} /></span><p><strong>Use as faction default</strong><small>Preselect this scheme for future reward calculations.</small></p></label>
          </section>

          <section className="reward-tier-section">
            <div className="reward-tier-section__heading"><div><h3>Hit ranges and rewards <InfoTip label="How ranges work">Minimum and maximum values are inclusive. Leave the final maximum empty to cover every higher hit count.</InfoTip></h3><p>Members receive the amount from the one enabled tier matching their final hit count.</p></div><div><button className="button button--quiet" onClick={normalizeRanges}><RotateCcw size={14} /> Normalize ranges</button><button className="button button--secondary" onClick={addTier}><Plus size={14} /> Add tier</button></div></div>
            {validation.length > 0 ? <div className="reward-validation" role="alert"><strong>Review {validation.length} issue{validation.length === 1 ? "" : "s"} before saving</strong><ul>{validation.slice(0, 4).map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : <div className="reward-validation reward-validation--valid"><Check size={15} /><span><strong>Ranges are valid</strong> Every enabled tier can be evaluated safely.</span></div>}
            <div className="professional-tier-table">
              <div className="professional-tier-table__head"><span>Order</span><span>Tier name</span><span>Minimum hits</span><span>Maximum hits</span><span>Member reward</span><span>Enabled</span><span>Controls</span></div>
              {draft.tiers.map((tier, index) => <div className={`professional-tier-row${tier.enabled ? "" : " professional-tier-row--disabled"}`} key={tier.id}>
                <div className="tier-order"><strong>{index + 1}</strong><span><button onClick={() => moveTier(index, -1)} disabled={index === 0} aria-label={`Move ${tier.label} up`}><ArrowUp size={13} /></button><button onClick={() => moveTier(index, 1)} disabled={index === draft.tiers.length - 1} aria-label={`Move ${tier.label} down`}><ArrowDown size={13} /></button></span></div>
                <label><span className="sr-only">Tier name</span><input value={tier.label} maxLength={50} onChange={(event) => updateTier(tier.id, { label: event.target.value })} /></label>
                <label><span className="sr-only">Minimum hits</span><input type="number" min={0} step={1} value={tier.minimumHits} onChange={(event) => updateTier(tier.id, { minimumHits: numeric(event.target.value) })} /></label>
                <label><span className="sr-only">Maximum hits</span><input type="number" min={0} step={1} value={tier.maximumHits ?? ""} placeholder="Unlimited" onChange={(event) => updateTier(tier.id, { maximumHits: event.target.value === "" ? null : numeric(event.target.value) })} /></label>
                <label className="tier-amount"><span className="sr-only">Reward amount</span><input type="number" min={0} step={1} value={tier.amount} onChange={(event) => updateTier(tier.id, { amount: Number(event.target.value) })} /><em>{draft.rewardUnit || "units"}</em></label>
                <label className="professional-switch"><input type="checkbox" checked={tier.enabled} onChange={(event) => updateTier(tier.id, { enabled: event.target.checked })} /><span aria-hidden="true" /><em>{tier.enabled ? "On" : "Off"}</em></label>
                <div className="tier-actions"><button onClick={() => setDraft({ ...draft, tiers: [...draft.tiers.slice(0, index + 1), { ...tier, id: crypto.randomUUID(), label: `${tier.label} copy` }, ...draft.tiers.slice(index + 1)] })} aria-label={`Duplicate ${tier.label}`}><Copy size={14} /></button><button onClick={() => removeTier(tier.id)} disabled={draft.tiers.length === 1} aria-label={`Delete ${tier.label}`}><Trash2 size={14} /></button></div>
              </div>)}
            </div>
            <footer className="reward-editor__footer"><p><strong>{draft.lockedByHistory ? "Version-safe saving" : "Editable version"}</strong><span>{draft.lockedByHistory ? "Historical payout snapshots remain attached to the prior version." : "This scheme remains editable until a chain or calculation references it."}</span></p>{!workspace.databaseAvailable && <Link href="/settings"><Database size={14} /> Configure database to save</Link>}</footer>
          </section>
        </>}
      </main>
    </div>
  </div>;
}

function editable(scheme: RewardSchemeView): EditableScheme {
  return { id: scheme.id, name: scheme.name, description: scheme.description, version: scheme.version, isDefault: scheme.isDefault, rewardName: scheme.rewardName, rewardUnit: scheme.rewardUnit, tiers: scheme.tiers.map((tier) => ({ ...tier })), lockedByHistory: scheme.lockedByHistory };
}

function starterScheme(): EditableScheme {
  const ranges = [[0, 5, 0, "Below threshold"], [6, 15, 1, "Entry"], [16, 25, 2, "Steady"], [26, 35, 3, "Committed"], [36, 45, 4, "High"], [46, null, 5, "Top"]] as const;
  return { id: null, name: "Standard chain rewards", description: "Standard contribution rewards for faction chains.", version: 1, isDefault: false, rewardName: "Xanax", rewardUnit: "Xanax", lockedByHistory: false, tiers: ranges.map(([minimumHits, maximumHits, amount, label]) => ({ id: crypto.randomUUID(), minimumHits, maximumHits, amount, label, enabled: true })) };
}

function validateDraft(draft: EditableScheme): string[] {
  const issues = validateRewardTiers(draft.tiers.map((tier, position) => ({ ...tier, position, rewards: [{ reward: { id: "draft-reward", name: draft.rewardName || "Reward", displayUnit: draft.rewardUnit || "units", kind: "item" as const, decimals: 0 }, amount: tier.amount }] }))).map((issue) => issue.message);
  if (draft.name.trim().length < 2) issues.unshift("Enter a scheme name with at least two characters.");
  if (!draft.rewardName.trim()) issues.unshift("Enter the reward item or unit.");
  if (!draft.tiers.some((tier) => tier.enabled)) issues.push("Enable at least one reward tier.");
  return [...new Set(issues)];
}

function numeric(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
