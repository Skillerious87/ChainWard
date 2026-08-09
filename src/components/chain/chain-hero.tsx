"use client";

import { Activity, Clock3, Crosshair, Expand, RefreshCw, TrendingUp, Users, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { notify } from "@/lib/client-actions";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";

interface ChainHeroProps {
  telemetry: WorkspaceTelemetry;
  detailed?: boolean;
}

export function ChainHero({ telemetry, detailed = false }: ChainHeroProps) {
  const [snapshotOverride, setSnapshotOverride] = useState<WorkspaceTelemetry | null>(null);
  const snapshot = newestTelemetry(telemetry, snapshotOverride);
  const [seconds, setSeconds] = useState(() => snapshotTimeout(telemetry));
  const [syncing, setSyncing] = useState(false);
  const [focus, setFocus] = useState(false);
  const exitButtonRef = useRef<HTMLButtonElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const chain = snapshot.chain;

  useEffect(() => {
    function receiveTelemetry(event: Event): void {
      const next = (event as CustomEvent<WorkspaceTelemetry>).detail;
      if (!isWorkspaceTelemetry(next)) return;
      setSnapshotOverride(next);
      setSeconds(snapshotTimeout(next));
    }
    window.addEventListener("chainward:telemetry", receiveTelemetry);
    return () => window.removeEventListener("chainward:telemetry", receiveTelemetry);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(
      () => setSeconds((value) => Math.max(0, value - 1)),
      1_000,
    );
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!focus) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    exitButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFocus(false);
        window.requestAnimationFrame(() => expandButtonRef.current?.focus());
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [focus]);

  function closeFocus(): void {
    setFocus(false);
    window.requestAnimationFrame(() => expandButtonRef.current?.focus());
  }

  async function refresh(): Promise<void> {
    if (syncing) return;
    setSyncing(true);
    try {
      const response = await fetch("/api/telemetry/live-chain?fresh=1", {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isWorkspaceTelemetry(payload)) {
        throw new Error("The telemetry response was invalid.");
      }
      setSnapshotOverride(payload);
      setSeconds(snapshotTimeout(payload));
      window.dispatchEvent(new CustomEvent<WorkspaceTelemetry>("chainward:telemetry", { detail: payload }));
      notify({
        title: payload.source === "live" ? "Torn telemetry checked" : "Telemetry unavailable",
        description: payload.source === "live" ? "Validated values are current within Torn’s service-cache window." : payload.message,
        tone: payload.source === "unavailable" ? "warning" : "success",
      });
    } catch {
      notify({
        title: "Telemetry refresh failed",
        description: "Existing values were kept. Check the API connection and try again.",
        tone: "danger",
      });
    } finally {
      setSyncing(false);
    }
  }

  if (!chain) {
    return (
      <section className="chain-console chain-console--unavailable">
        <div className="chain-console__toolbar">
          <div className="live-label live-label--unavailable"><i /> Live chain telemetry</div>
          <button className="button button--quiet" onClick={() => void refresh()} disabled={syncing}>
            <RefreshCw className={syncing ? "spin" : undefined} size={15} />
            {syncing ? "Checking" : "Retry connection"}
          </button>
        </div>
        <div className="chain-unavailable">
          <span><Activity size={21} /></span>
          <div><p className="eyebrow">Live data unavailable</p><h2>Telemetry is safely paused</h2><p>{snapshot.message}</p></div>
          <Link className="button button--primary" href="/connect">Connect Torn API</Link>
        </div>
      </section>
    );
  }

  if (chain.state !== "active") {
    const cooldown = chain.state === "cooldown";
    const StateIcon = cooldown ? Clock3 : Activity;
    const stateTitle = cooldown ? "Chain cooldown in progress" : "No active chain";
    const stateDescription = cooldown
      ? `Torn reports a cooldown until ${formatTornTime(chain.cooldownAt)}. Active progress will return automatically when the next chain starts.`
      : "Torn reports that the faction is idle. Last-chain fields are kept separate from live progress to avoid presenting stale values as current.";

    return (
      <section className={`chain-console chain-console--paused chain-console--${chain.state}`}>
        <div className="chain-console__toolbar">
          <div className="live-label live-label--paused"><i /> Verified Torn telemetry</div>
          <div className="chain-console__toolbar-actions">
            <span>Checked {formatCheckedTime(snapshot.checkedAt)}</span>
            <button className="button button--quiet" onClick={() => void refresh()} disabled={syncing}><RefreshCw className={syncing ? "spin" : undefined} size={15} />{syncing ? "Checking" : "Sync now"}</button>
          </div>
        </div>
        <div className="chain-unavailable chain-paused-state">
          <span><StateIcon size={21} /></span>
          <div><p className="eyebrow">{cooldown ? "Cooldown" : "Faction ready"}</p><h2>{stateTitle}</h2><p>{stateDescription}</p></div>
          <Link className="button button--secondary" href="/chains">View chain history</Link>
        </div>
        <div className="chain-console__metrics">
          <div><span><Users size={17} /></span><small>Faction members</small><strong>{snapshot.faction?.members || "—"}</strong><p>Current faction basic response</p></div>
          <div><span><Crosshair size={17} /></span><small>Last chain ID</small><strong>{chain.id > 0 ? `#${chain.id}` : "—"}</strong><p>Returned by Torn</p></div>
          <div><span><Activity size={17} /></span><small>Last recorded hits</small><strong>{chain.id > 0 ? chain.current.toLocaleString() : "—"}</strong><p>Not displayed as live progress</p></div>
          <div><span className="chain-metric__symbol">✓</span><small>Data provenance</small><strong>Live<em> API</em></strong><p>Validated server-side</p></div>
        </div>
      </section>
    );
  }

  const progress = chain.maximum > 0 ? Math.min(100, (chain.current / chain.maximum) * 100) : 0;
  const remaining = Math.max(0, chain.maximum - chain.current);
  const elapsedSeconds = Math.max(0, Math.floor(Date.parse(snapshot.checkedAt) / 1_000) - chain.startedAt);
  const factionMembers = snapshot.faction?.members ?? 0;

  return (
    <section
      className={`chain-console${detailed ? " chain-console--detailed" : ""}${focus ? " chain-console--focus" : ""}`}
      role={focus ? "dialog" : undefined}
      aria-modal={focus || undefined}
      aria-label={focus ? "Expanded live chain telemetry" : undefined}
    >
      {focus && (
        <button ref={exitButtonRef} className="chain-focus-exit" onClick={closeFocus}>
          <X size={17} /><span>Exit expanded view</span><kbd>Esc</kbd>
        </button>
      )}

      <div className="chain-console__toolbar">
        <div className="live-label"><i /> Verified Torn telemetry <span>#{chain.id}</span></div>
        <div className="chain-console__toolbar-actions">
          <span>Official service cache · up to 30s</span>
          <button className="button button--quiet" onClick={() => void refresh()} disabled={syncing}><RefreshCw className={syncing ? "spin" : undefined} size={15} />{syncing ? "Checking" : "Sync now"}</button>
          {!focus && <button ref={expandButtonRef} className="icon-button chain-focus-button" onClick={() => setFocus(true)} aria-label="Expand live chain telemetry" title="Expand telemetry"><Expand size={16} /></button>}
        </div>
      </div>

      <div className="chain-console__body">
        <div className="chain-console__primary">
          <span className="chain-console__kicker">Current progress</span>
          <div className="chain-count" aria-live="polite"><strong>{chain.current.toLocaleString()}</strong><span><i>/</i>{chain.maximum.toLocaleString()}</span></div>
          <div className="chain-progress chain-progress--console" aria-label={`${progress.toFixed(1)}% chain progress`}>
            <div className="chain-progress__track"><div className="chain-progress__fill" style={{ width: `${progress}%` }} />{[25, 50, 75].map((value) => <i key={value} style={{ left: `${value}%` }} />)}</div>
            <div className="chain-progress__labels"><span><b>{progress.toFixed(1)}%</b> complete</span><span>{remaining.toLocaleString()} hits to target</span></div>
          </div>
          <div className="chain-console__pace"><TrendingUp size={14} /><span>Torn chain modifier</span><strong>{chain.modifier.toFixed(2)}×</strong><em>Live member totals require a matching chain report</em></div>
        </div>

        <div className={`timeout-orbit${seconds < 90 ? " timeout-orbit--risk" : ""}`} style={{ "--timeout": `${Math.min(100, (seconds / 300) * 100)}%` } as React.CSSProperties}>
          <div className="timeout-orbit__ring"><div><Clock3 size={17} /><strong>{formatTime(seconds)}</strong><span>timeout</span></div></div>
          <p><i /> {seconds < 90 ? "Critical window" : "Watch window"}</p>
          <small>Official timeout, counting down locally</small>
        </div>
      </div>

      <div className="chain-console__metrics">
        <div><span><Users size={17} /></span><small>Faction members</small><strong>{factionMembers || "—"}</strong><p>From faction basic endpoint</p></div>
        <div><span><Crosshair size={17} /></span><small>Maximum chain</small><strong>{chain.maximum.toLocaleString()}<em> hits</em></strong><p>Returned by Torn</p></div>
        <div><span><Activity size={17} /></span><small>Elapsed runtime</small><strong>{formatDuration(elapsedSeconds)}</strong><p>Started {formatTornTime(chain.startedAt)}</p></div>
        <div><span className="chain-metric__symbol">✓</span><small>Data provenance</small><strong>Live<em> API</em></strong><p>Validated server-side</p></div>
      </div>
    </section>
  );
}

function snapshotTimeout(telemetry: WorkspaceTelemetry): number {
  if (!telemetry.chain) return 0;
  if (telemetry.chain.state === "cooldown") {
    return Math.max(0, telemetry.chain.cooldownAt - Math.floor(Date.now() / 1_000));
  }
  if (telemetry.chain.state !== "active") return 0;
  const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(telemetry.checkedAt)) / 1_000));
  return Math.max(0, telemetry.chain.timeoutSeconds - ageSeconds);
}

function formatCheckedTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "time unavailable";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(timestamp);
}

function newestTelemetry(server: WorkspaceTelemetry, override: WorkspaceTelemetry | null): WorkspaceTelemetry {
  if (!override) return server;
  const serverTime = Date.parse(server.checkedAt);
  const overrideTime = Date.parse(override.checkedAt);
  return Number.isFinite(serverTime) && serverTime > overrideTime ? server : override;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remaining = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatTornTime(timestamp: number): string {
  if (timestamp <= 0) return "—";
  return `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(timestamp * 1_000)} TCT`;
}

function isWorkspaceTelemetry(value: unknown): value is WorkspaceTelemetry {
  if (!value || typeof value !== "object" || !("source" in value) || !("checkedAt" in value)) return false;
  const candidate = value as Partial<WorkspaceTelemetry>;
  return (candidate.source === "live" || candidate.source === "unavailable")
    && typeof candidate.checkedAt === "string";
}
