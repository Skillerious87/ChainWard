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
  SlidersHorizontal,
  Table2,
  Trash2,
  TriangleAlert,
  Undo2,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { saveRewardScheme, setRewardSchemeArchived } from "@/app/(platform)/rewards/actions";
import { publishViewSwitch } from "@/components/shell/route-progress";
import { InfoTip } from "@/components/ui/info-tip";
import { Spinner } from "@/components/ui/spinner";
import { notify } from "@/lib/client-actions";
import { analyzeRewardCoverage, validateRewardTiers } from "@/lib/rewards/reward-engine";
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

type EditorTab = "details" | "tiers" | "preview";

const TABS: { id: EditorTab; label: string; icon: typeof Table2 }[] = [
  { id: "details", label: "Details", icon: SlidersHorizontal },
  { id: "tiers", label: "Hit ranges", icon: Table2 },
  { id: "preview", label: "Payout preview", icon: Sparkles },
];

export function RewardSchemesManager({ workspace }: { workspace: RewardWorkspaceView }) {
  const router = useRouter();
  const initial = preferredScheme(workspace);
  const [selectedId, setSelectedId] = useState<string | null>(initial?.id ?? null);
  const [draft, setDraft] = useState<EditableScheme | null>(() => (initial ? editable(initial) : null));
  const [baseline, setBaseline] = useState<string>(() => (initial ? fingerprint(editable(initial)) : ""));
  const [tab, setTab] = useState<EditorTab>("tiers");
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [previewHits, setPreviewHits] = useState(24);
  const revisionRef = useRef(workspace.revision);
  const pendingSelectionRef = useRef<string | null>(null);

  const visibleSchemes = workspace.schemes.filter((scheme) => showArchived || scheme.status !== "ARCHIVED");
  const archivedCount = workspace.schemes.filter((scheme) => scheme.status === "ARCHIVED").length;
  const defaultScheme = workspace.schemes.find((scheme) => scheme.isDefault && scheme.status === "ACTIVE");
  const validation = useMemo(() => (draft ? validateDraft(draft) : []), [draft]);
  const coverage = useMemo(() => (draft ? analyzeRewardCoverage(toEngineTiers(draft)) : null), [draft]);
  const dirty = Boolean(draft) && fingerprint(draft!) !== baseline;
  const savable = Boolean(draft) && validation.length === 0 && workspace.databaseAvailable && (dirty || draft?.id === null);

  /**
   * A save revalidates the route, which replaces `workspace` in place. Rebind
   * the editor to the persisted record instead of leaving the operator looking
   * at a stale draft or losing their selection entirely.
   */
  useEffect(() => {
    if (revisionRef.current === workspace.revision) return;
    revisionRef.current = workspace.revision;
    const targetId = pendingSelectionRef.current ?? selectedId;
    pendingSelectionRef.current = null;
    const match = workspace.schemes.find((scheme) => scheme.id === targetId) ?? preferredScheme(workspace);
    setSelectedId(match?.id ?? null);
    setDraft(match ? editable(match) : null);
    setBaseline(match ? fingerprint(editable(match)) : "");
  }, [workspace, selectedId]);

  const save = useCallback(async (): Promise<void> => {
    if (!draft || validation.length || !workspace.databaseAvailable || saving) return;
    setSaving(true);
    try {
      const result = await saveRewardScheme(draft);
      pendingSelectionRef.current = result.id;
      const verb = result.mode === "versioned" ? `Version ${result.version} created` : result.mode === "updated" ? "Scheme updated" : "Scheme created";
      notify({ title: verb, description: "The reward rules are saved in the faction database.", tone: "success" });
      router.refresh();
    } catch (error) {
      notify({ title: "Scheme not saved", description: error instanceof Error ? error.message : "Review the reward rules and try again.", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }, [draft, router, saving, validation.length, workspace.databaseAvailable]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void save();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  function selectScheme(scheme: RewardSchemeView): void {
    if (scheme.id !== selectedId) publishViewSwitch(`reward-scheme:${scheme.id}`);
    setSelectedId(scheme.id);
    setDraft(editable(scheme));
    setBaseline(fingerprint(editable(scheme)));
  }

  function startNew(source?: EditableScheme): void {
    const next = source
      ? {
        ...source,
        id: null,
        name: `${source.name} copy`,
        version: 1,
        isDefault: false,
        lockedByHistory: false,
        tiers: source.tiers.map((tier) => ({ ...tier, id: crypto.randomUUID() })),
      }
      : starterScheme();
    setSelectedId(null);
    setDraft(next);
    setBaseline("");
    selectTab("details");
  }

  function discardChanges(): void {
    const source = workspace.schemes.find((scheme) => scheme.id === selectedId);
    if (!source) return;
    setDraft(editable(source));
    setBaseline(fingerprint(editable(source)));
    notify({ title: "Changes discarded", description: "The editor was reset to the saved version.", tone: "info" });
  }

  function selectTab(next: EditorTab): void {
    if (next === tab) return;
    publishViewSwitch(`reward-editor:${next}`);
    setTab(next);
  }

  function handleTabKey(event: ReactKeyboardEvent<HTMLButtonElement>, current: EditorTab): void {
    const currentIndex = TABS.findIndex((item) => item.id === current);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = TABS[nextIndex];
    if (!next) return;
    selectTab(next.id);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      .item(nextIndex)
      .focus();
  }

  function updateTier(id: string, changes: Partial<RewardTierView>): void {
    setDraft((current) => (current ? { ...current, tiers: current.tiers.map((tier) => (tier.id === id ? { ...tier, ...changes } : tier)) } : current));
  }

  function addTier(): void {
    setDraft((current) => {
      if (!current) return current;
      const tiers = current.tiers.map((tier) => ({ ...tier }));
      const last = tiers.at(-1);
      // A new final tier has to start above everything that already exists, so
      // an open-ended last tier is closed at its own minimum rather than at an
      // arbitrary offset that could silently swallow hit counts.
      if (last && last.maximumHits === null) last.maximumHits = last.minimumHits;
      const highest = tiers.reduce((maximum, tier) => Math.max(maximum, tier.maximumHits ?? tier.minimumHits), -1);
      return {
        ...current,
        tiers: [...tiers, {
          id: crypto.randomUUID(),
          label: `Tier ${tiers.length + 1}`,
          minimumHits: highest + 1,
          maximumHits: null,
          amount: (last?.amount ?? 0) + 1,
          enabled: true,
        }],
      };
    });
  }

  function removeTier(id: string): void {
    setDraft((current) => (current ? { ...current, tiers: current.tiers.filter((tier) => tier.id !== id) } : current));
  }

  function duplicateTier(index: number): void {
    setDraft((current) => {
      if (!current) return current;
      const tier = current.tiers[index];
      if (!tier) return current;
      return { ...current, tiers: [...current.tiers.slice(0, index + 1), { ...tier, id: crypto.randomUUID(), label: `${tier.label} copy` }, ...current.tiers.slice(index + 1)] };
    });
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

  /**
   * Sorts enabled tiers, closes every gap, removes overlaps, and leaves exactly
   * one open-ended final tier. Disabled tiers keep their own ranges and stay in
   * place so a temporarily switched-off tier is not silently rewritten.
   */
  function normalizeRanges(): void {
    setDraft((current) => {
      if (!current) return current;
      const enabled = current.tiers.filter((tier) => tier.enabled).toSorted((left, right) => left.minimumHits - right.minimumHits || left.amount - right.amount);
      if (enabled.length === 0) return current;
      let cursor = 0;
      const rewritten = new Map<string, RewardTierView>();
      enabled.forEach((tier, index) => {
        const last = index === enabled.length - 1;
        const minimumHits = cursor;
        const declaredMaximum = tier.maximumHits ?? tier.minimumHits;
        const maximumHits = last ? null : Math.max(minimumHits, declaredMaximum);
        cursor = (maximumHits ?? minimumHits) + 1;
        rewritten.set(tier.id, { ...tier, minimumHits, maximumHits });
      });
      const tiers = [
        ...enabled.map((tier) => rewritten.get(tier.id)!),
        ...current.tiers.filter((tier) => !tier.enabled),
      ];
      return { ...current, tiers };
    });
    notify({ title: "Ranges rebuilt", description: "Enabled tiers now run in order from zero with no gaps and one open final tier.", tone: "success" });
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

  const matchedTier = draft ? findTier(draft.tiers, previewHits) : null;
  const enabledTiers = draft?.tiers.filter((tier) => tier.enabled) ?? [];

  return (
    <div className="reward-console">
      <header className="reward-console__bar">
        <div className="reward-console__identity">
          <p className="eyebrow">Reward operations</p>
          <h1>Reward schemes</h1>
        </div>
        <dl className="reward-console__meta">
          <div><dt>Saved versions</dt><dd>{workspace.schemes.length}</dd></div>
          <div><dt>Faction default</dt><dd title={defaultScheme?.name}>{defaultScheme?.name ?? "Not set"}</dd></div>
          <div><dt>Enabled tiers</dt><dd>{enabledTiers.length}</dd></div>
          <div><dt>Reward unit</dt><dd>{draft?.rewardUnit || "Not set"}</dd></div>
        </dl>
        <div className="reward-console__actions">
          <Link className={`reward-storage-pill reward-storage-pill--${workspace.databaseAvailable ? "ready" : "attention"}`} href="/settings" title={workspace.message}>
            <Database size={13} /> {workspace.databaseAvailable ? "Storage ready" : "Storage required"}
          </Link>
          <button className="button button--primary" onClick={() => startNew()}><Plus size={15} /> New scheme</button>
        </div>
      </header>

      <div className="reward-console__grid">
        <aside className="reward-library">
          <header>
            <div><p className="eyebrow">Scheme library</p><h2>Saved rules</h2></div>
            <span>{visibleSchemes.length}</span>
          </header>
          <button className={`reward-library__new${selectedId === null && draft ? " reward-library__new--active" : ""}`} onClick={() => startNew()}>
            <span><FilePlus2 size={17} /></span>
            <p><strong>New guided scheme</strong><small>Six editable hit ranges</small></p>
          </button>
          <div className="reward-library__list">
            {visibleSchemes.map((scheme) => (
              <button key={scheme.id} className={selectedId === scheme.id ? "reward-library__item reward-library__item--active" : "reward-library__item"} onClick={() => selectScheme(scheme)}>
                <span className="scheme-icon">{scheme.name.slice(0, 2).toUpperCase()}</span>
                <p><strong>{scheme.name}</strong><small>Version {scheme.version} · {scheme.tiers.length} tiers</small></p>
                <em className={scheme.status === "ARCHIVED" ? "scheme-state scheme-state--archived" : scheme.isDefault ? "scheme-state scheme-state--default" : "scheme-state"}>{scheme.status === "ARCHIVED" ? "Archived" : scheme.isDefault ? "Default" : "Active"}</em>
              </button>
            ))}
            {visibleSchemes.length === 0 && <div className="reward-library__empty"><CircleDollarSign size={20} /><strong>No saved schemes</strong><small>Create a guided scheme to begin.</small></div>}
          </div>
          {archivedCount > 0 && <button className="reward-library__archive-toggle" onClick={() => setShowArchived((value) => !value)}><Archive size={14} /> {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}</button>}
        </aside>

        <section className="reward-editor">
          {!draft ? (
            <div className="reward-editor__empty">
              <span><Sparkles size={24} /></span>
              <h2>Create an understandable payout policy</h2>
              <p>Start with the guided template, then adjust the ranges and reward amounts to match your faction.</p>
              <button className="button button--primary" onClick={() => startNew()}><Plus size={16} /> Start guided setup</button>
            </div>
          ) : (
            <>
              <header className="reward-editor__top">
                <div className="reward-editor__identity">
                  <div className="reward-editor__badges">
                    <span className="reward-editor__version">{draft.id ? `Version ${draft.version}` : "Unsaved"}</span>
                    {draft.lockedByHistory && <span className="reward-editor__protected"><BadgeCheck size={12} /> History protected</span>}
                    {dirty && <span className="reward-editor__dirty">Unsaved changes</span>}
                  </div>
                  <h2>{draft.name || "Untitled reward scheme"}</h2>
                </div>
                <div className="reward-editor__controls">
                  {dirty && draft.id && <button className="button button--quiet" onClick={discardChanges}><Undo2 size={14} /> Discard</button>}
                  {draft.id && <button className="button button--quiet" onClick={() => startNew(draft)}><Copy size={14} /> Duplicate</button>}
                  {draft.id && <button className="button button--quiet" onClick={() => { const source = workspace.schemes.find((scheme) => scheme.id === draft.id); if (source) void archive(source); }}><Archive size={14} /> Archive</button>}
                  <button className="button button--primary" disabled={saving || !savable} onClick={() => void save()} title={workspace.databaseAvailable ? "Save (Ctrl+S)" : workspace.message}>
                    {saving ? <Spinner size={14} label="Saving reward scheme" /> : <Save size={14} />} {saving ? "Saving…" : draft.lockedByHistory ? "Save new version" : "Save scheme"}
                  </button>
                </div>
              </header>

              <nav className="reward-tabs" role="tablist" aria-label="Scheme editor sections">
                {TABS.map(({ id, label, icon: Icon }) => (
                  <button type="button" id={`reward-tab-${id}`} role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} key={id} className={tab === id ? "reward-tab reward-tab--active" : "reward-tab"} onClick={() => selectTab(id)} onKeyDown={(event) => handleTabKey(event, id)}>
                    <Icon size={14} /> {label}
                    {id === "tiers" && validation.length > 0 && <em className="reward-tab__flag reward-tab__flag--error">{validation.length}</em>}
                    {id === "tiers" && validation.length === 0 && coverage && coverage.gaps.length > 0 && <em className="reward-tab__flag reward-tab__flag--warn">{coverage.gaps.length}</em>}
                  </button>
                ))}
              </nav>

              <div id={`reward-panel-${tab}`} className="reward-editor__pane" role="tabpanel" aria-labelledby={`reward-tab-${tab}`} tabIndex={0} key={tab}>
                {tab === "details" && (
                  <div className="reward-detail-grid">
                    <label>
                      <span>Scheme name <InfoTip label="About scheme names">Use a name faction leaders will recognize when assigning a scheme to a chain.</InfoTip></span>
                      <input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Standard chain rewards" />
                    </label>
                    <label>
                      <span>Reward item <InfoTip label="About reward items">This is the item or unit granted by every tier. Multiple reward types can be added in a future version.</InfoTip></span>
                      <input value={draft.rewardName} maxLength={40} onChange={(event) => setDraft({ ...draft, rewardName: event.target.value, rewardUnit: event.target.value })} placeholder="Xanax" />
                    </label>
                    <label className="reward-detail-grid__wide">
                      <span>Description</span>
                      <input value={draft.description} maxLength={300} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="When should faction leaders use this scheme?" />
                    </label>
                    <label className="reward-default-toggle reward-detail-grid__wide">
                      <input type="checkbox" checked={draft.isDefault} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} />
                      <span><Check size={13} /></span>
                      <p><strong>Use as faction default</strong><small>Preselect this scheme for future reward calculations.</small></p>
                    </label>
                    <div className="reward-version-note reward-detail-grid__wide">
                      <strong>{draft.lockedByHistory ? "Version-safe saving" : "Editable version"}</strong>
                      <p>{draft.lockedByHistory
                        ? "This scheme has been used by a chain or calculation. Saving creates a new version and the historical payout snapshots stay attached to the version that produced them."
                        : "No chain or calculation references this scheme yet, so saving updates it in place."}</p>
                    </div>
                  </div>
                )}

                {tab === "tiers" && (
                  <div className="reward-tier-pane">
                    <div className="reward-tier-pane__toolbar">
                      <div>
                        <h3>Hit ranges and rewards <InfoTip label="How ranges work">Minimum and maximum values are inclusive. Leave the final maximum empty to cover every higher hit count.</InfoTip></h3>
                        <p>Members receive the amount from the one enabled tier matching their final hit count.</p>
                      </div>
                      <div>
                        <button className="button button--quiet" onClick={normalizeRanges} title="Sort, close gaps, and leave one open final tier"><RotateCcw size={14} /> Rebuild ranges</button>
                        <button className="button button--secondary" onClick={addTier}><Plus size={14} /> Add tier</button>
                      </div>
                    </div>

                    <RangeStatus validation={validation} coverage={coverage} unit={draft.rewardUnit} onFix={normalizeRanges} />

                    <div className="reward-tier-table" role="table" aria-label="Reward tiers">
                      <div className="reward-tier-table__head" role="row">
                        <span>Order</span><span>Tier name</span><span>Minimum</span><span>Maximum</span><span>Reward</span><span>Enabled</span><span>Controls</span>
                      </div>
                      {draft.tiers.map((tier, index) => (
                        <div className={`reward-tier-row${tier.enabled ? "" : " reward-tier-row--disabled"}`} key={tier.id} role="row">
                          <div className="tier-order">
                            <strong>{index + 1}</strong>
                            <span>
                              <button onClick={() => moveTier(index, -1)} disabled={index === 0} aria-label={`Move ${tier.label} up`}><ArrowUp size={13} /></button>
                              <button onClick={() => moveTier(index, 1)} disabled={index === draft.tiers.length - 1} aria-label={`Move ${tier.label} down`}><ArrowDown size={13} /></button>
                            </span>
                          </div>
                          <label><span className="sr-only">Tier name</span><input value={tier.label} maxLength={50} onChange={(event) => updateTier(tier.id, { label: event.target.value })} /></label>
                          <label><span className="sr-only">Minimum hits</span><input type="number" min={0} step={1} value={tier.minimumHits} onChange={(event) => updateTier(tier.id, { minimumHits: numeric(event.target.value) })} /></label>
                          <label><span className="sr-only">Maximum hits</span><input type="number" min={0} step={1} value={tier.maximumHits ?? ""} placeholder="Unlimited" onChange={(event) => updateTier(tier.id, { maximumHits: event.target.value === "" ? null : numeric(event.target.value) })} /></label>
                          <label className="tier-amount"><span className="sr-only">Reward amount</span><input type="number" min={0} step={1} value={tier.amount} onChange={(event) => updateTier(tier.id, { amount: numeric(event.target.value) })} /><em>{draft.rewardUnit || "units"}</em></label>
                          <label className="professional-switch"><input type="checkbox" checked={tier.enabled} onChange={(event) => updateTier(tier.id, { enabled: event.target.checked })} /><span aria-hidden="true" /><em>{tier.enabled ? "On" : "Off"}</em></label>
                          <div className="tier-actions">
                            <button onClick={() => duplicateTier(index)} aria-label={`Duplicate ${tier.label}`}><Copy size={14} /></button>
                            <button onClick={() => removeTier(tier.id)} disabled={draft.tiers.length === 1} aria-label={`Delete ${tier.label}`}><Trash2 size={14} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {tab === "preview" && (
                  <div className="reward-preview">
                    <section className="reward-simulator">
                      <header>
                        <div><h3>Payout simulator</h3><p>Check what one member receives before the rules reach a real chain.</p></div>
                        <div className="reward-simulator__input">
                          <label htmlFor="preview-hits">Final hits</label>
                          <input id="preview-hits" type="number" min={0} step={1} value={previewHits} onChange={(event) => setPreviewHits(Math.max(0, numeric(event.target.value)))} />
                        </div>
                      </header>
                      <div className={`reward-simulator__result reward-simulator__result--${matchedTier ? "matched" : "unmatched"}`}>
                        {matchedTier ? (
                          <>
                            <strong>{matchedTier.amount.toLocaleString()} <em>{draft.rewardUnit || "units"}</em></strong>
                            <p>A member finishing on {previewHits.toLocaleString()} hits is paid by <b>{matchedTier.label}</b> ({rangeLabel(matchedTier)}).</p>
                          </>
                        ) : (
                          <>
                            <strong>No reward</strong>
                            <p>{previewHits.toLocaleString()} hits falls outside every enabled tier, so this member would be paid nothing. Rebuild the ranges to close the gap.</p>
                          </>
                        )}
                      </div>
                      <input className="reward-simulator__slider" type="range" min={0} max={Math.max(60, (coverage?.highestCoveredHits ?? 60) + 20)} value={previewHits} onChange={(event) => setPreviewHits(numeric(event.target.value))} aria-label="Final hits" />
                    </section>

                    <section className="reward-ladder">
                      <header><h3>Reward ladder</h3><p>{enabledTiers.length} enabled {enabledTiers.length === 1 ? "tier" : "tiers"}, in payout order.</p></header>
                      <ol>
                        {enabledTiers.toSorted((left, right) => left.minimumHits - right.minimumHits).map((tier) => {
                          const active = matchedTier?.id === tier.id;
                          const share = maxAmount(enabledTiers) > 0 ? (tier.amount / maxAmount(enabledTiers)) * 100 : 0;
                          return (
                            <li key={tier.id} className={active ? "reward-ladder__row reward-ladder__row--active" : "reward-ladder__row"}>
                              <span className="reward-ladder__label"><strong>{tier.label}</strong><small>{rangeLabel(tier)}</small></span>
                              <span className="reward-ladder__bar"><i style={{ width: `${Math.max(share, 2)}%` }} /></span>
                              <span className="reward-ladder__amount">{tier.amount.toLocaleString()} <small>{draft.rewardUnit || "units"}</small></span>
                            </li>
                          );
                        })}
                        {enabledTiers.length === 0 && <li className="reward-ladder__empty">Enable at least one tier to preview payouts.</li>}
                      </ol>
                    </section>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function RangeStatus({ validation, coverage, unit, onFix }: { validation: string[]; coverage: ReturnType<typeof analyzeRewardCoverage> | null; unit: string; onFix: () => void }) {
  if (validation.length > 0) {
    return (
      <div className="reward-status reward-status--error" role="alert">
        <TriangleAlert size={16} />
        <div>
          <strong>Resolve {validation.length} issue{validation.length === 1 ? "" : "s"} before saving</strong>
          <ul>{validation.slice(0, 4).map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div>
        <button className="button button--quiet" onClick={onFix}><Wand2 size={13} /> Rebuild ranges</button>
      </div>
    );
  }

  if (coverage && coverage.gaps.length > 0) {
    return (
      <div className="reward-status reward-status--warn" role="status">
        <TriangleAlert size={16} />
        <div>
          <strong>{coverage.gaps.length} hit range{coverage.gaps.length === 1 ? "" : "s"} pay nothing</strong>
          <ul>{coverage.gaps.map((gap) => <li key={`${gap.fromHits}-${gap.toHits ?? "up"}`}>{gap.toHits === null ? `${gap.fromHits.toLocaleString()} hits and above` : gap.fromHits === gap.toHits ? `${gap.fromHits.toLocaleString()} hits` : `${gap.fromHits.toLocaleString()}–${gap.toHits.toLocaleString()} hits`} is not claimed by any enabled tier.</li>)}</ul>
        </div>
        <button className="button button--quiet" onClick={onFix}><Wand2 size={13} /> Close gaps</button>
      </div>
    );
  }

  return (
    <div className="reward-status reward-status--valid" role="status">
      <Check size={16} />
      <div><strong>Every hit count is covered</strong><p>All ranges are valid and each member is matched to exactly one {unit || "reward"} tier.</p></div>
    </div>
  );
}

function preferredScheme(workspace: RewardWorkspaceView): RewardSchemeView | undefined {
  return workspace.schemes.find((scheme) => scheme.isDefault && scheme.status === "ACTIVE")
    ?? workspace.schemes.find((scheme) => scheme.status === "ACTIVE")
    ?? workspace.schemes[0];
}

function editable(scheme: RewardSchemeView): EditableScheme {
  return { id: scheme.id, name: scheme.name, description: scheme.description, version: scheme.version, isDefault: scheme.isDefault, rewardName: scheme.rewardName, rewardUnit: scheme.rewardUnit, tiers: scheme.tiers.map((tier) => ({ ...tier })), lockedByHistory: scheme.lockedByHistory };
}

/** Stable comparison value used to detect unsaved edits. */
function fingerprint(draft: EditableScheme): string {
  return JSON.stringify({
    name: draft.name,
    description: draft.description,
    isDefault: draft.isDefault,
    rewardName: draft.rewardName,
    rewardUnit: draft.rewardUnit,
    tiers: draft.tiers.map((tier) => [tier.label, tier.minimumHits, tier.maximumHits, tier.amount, tier.enabled]),
  });
}

function starterScheme(): EditableScheme {
  const ranges = [[0, 5, 0, "Below threshold"], [6, 15, 1, "Entry"], [16, 25, 2, "Steady"], [26, 35, 3, "Committed"], [36, 45, 4, "High"], [46, null, 5, "Top"]] as const;
  return { id: null, name: "Standard chain rewards", description: "Standard contribution rewards for faction chains.", version: 1, isDefault: false, rewardName: "Xanax", rewardUnit: "Xanax", lockedByHistory: false, tiers: ranges.map(([minimumHits, maximumHits, amount, label]) => ({ id: crypto.randomUUID(), minimumHits, maximumHits, amount, label, enabled: true })) };
}

function toEngineTiers(draft: EditableScheme) {
  return draft.tiers.map((tier, position) => ({
    ...tier,
    position,
    rewards: [{ reward: { id: "draft-reward", name: draft.rewardName || "Reward", displayUnit: draft.rewardUnit || "units", kind: "item" as const, decimals: 0 }, amount: tier.amount }],
  }));
}

function validateDraft(draft: EditableScheme): string[] {
  const issues = validateRewardTiers(toEngineTiers(draft)).map((issue) => issue.message);
  if (draft.name.trim().length < 2) issues.unshift("Enter a scheme name with at least two characters.");
  if (!draft.rewardName.trim()) issues.unshift("Enter the reward item or unit.");
  if (!draft.tiers.some((tier) => tier.enabled)) issues.push("Enable at least one reward tier.");
  return [...new Set(issues)];
}

function findTier(tiers: readonly RewardTierView[], hits: number): RewardTierView | null {
  return tiers
    .filter((tier) => tier.enabled)
    .toSorted((left, right) => left.minimumHits - right.minimumHits)
    .find((tier) => hits >= tier.minimumHits && (tier.maximumHits === null || hits <= tier.maximumHits)) ?? null;
}

function rangeLabel(tier: RewardTierView): string {
  return tier.maximumHits === null ? `${tier.minimumHits.toLocaleString()}+ hits` : `${tier.minimumHits.toLocaleString()}–${tier.maximumHits.toLocaleString()} hits`;
}

function maxAmount(tiers: readonly RewardTierView[]): number {
  return tiers.reduce((maximum, tier) => Math.max(maximum, tier.amount), 0);
}

function numeric(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
