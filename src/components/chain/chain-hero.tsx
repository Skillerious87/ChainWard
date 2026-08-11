"use client";

import { Activity, Clock3, Crosshair, Expand, RefreshCw, TrendingUp, Users, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { notify } from "@/lib/client-actions";
import { observeTornClock, recordClockSample, tornNow } from "@/lib/torn/chain-clock";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";

interface ChainHeroProps {
  telemetry: WorkspaceTelemetry;
  detailed?: boolean;
}

/**
 * Torn awards a flat respect bonus at thirteen fixed chain lengths. Torn's
 * `max` field reports the next of these, not a faction ceiling, so the gauge
 * measures progress to the next bonus and this ladder gives that number its
 * context. The values are a documented game rule, not derived data.
 * https://wiki.torn.com/wiki/Chain
 */
const CHAIN_BONUS_MILESTONES = [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000] as const;

/** Torn's standard chain timeout, used until a wider one is observed. */
const DEFAULT_TIMEOUT_WINDOW = 300;

/** The milestones worth showing around the current target. */
function milestoneWindow(target: number): number[] {
  const index = CHAIN_BONUS_MILESTONES.findIndex((value) => value >= target);
  if (index < 0) return [...CHAIN_BONUS_MILESTONES].slice(-4);
  return [...CHAIN_BONUS_MILESTONES].slice(Math.max(0, index - 1), index + 3);
}

export function ChainHero({ telemetry, detailed = false }: ChainHeroProps) {
  const [snapshotOverride, setSnapshotOverride] = useState<WorkspaceTelemetry | null>(null);
  const snapshot = newestTelemetry(telemetry, snapshotOverride);
  // Ticking a stored counter down by one each second drifts whenever the tab is
  // throttled or the machine sleeps. The countdown is derived from a wall-clock
  // deadline instead, so it is correct the moment the tab becomes visible again.
  const [now, setNow] = useState(() => tornNow());
  const seconds = remainingSeconds(snapshot, now);
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
      setNow(tornNow());
    }
    window.addEventListener("chainward:telemetry", receiveTelemetry);
    return () => window.removeEventListener("chainward:telemetry", receiveTelemetry);
  }, []);

  useEffect(() => {
    function tick(): void { setNow(tornNow()); }
    // Four times a second: the label still reads whole seconds, but the ring
    // sweeps continuously instead of stepping once per second.
    const interval = window.setInterval(tick, 250);
    // A hidden tab is throttled, so re-read the clock as soon as it returns.
    document.addEventListener("visibilitychange", tick);
    // Re-read immediately when the measured offset from Torn's clock changes.
    const stopObserving = observeTornClock(tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
      stopObserving();
    };
  }, []);

  // Torn restarts the countdown on every hit, so the largest figure it has
  // reported is the real width of the window. Deriving it keeps the ring honest
  // for a faction whose timer runs longer than the standard five minutes.
  const timeoutWindow = Math.max(DEFAULT_TIMEOUT_WINDOW, snapshot.chain?.timeoutSeconds ?? 0, seconds);

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
      const startedAt = Date.now();
      const response = await fetch("/api/telemetry/live-chain?fresh=1", {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      if (isWorkspaceTelemetry(payload)) recordClockSample(payload.clockAt, startedAt, Date.now());
      if (!response.ok || !isWorkspaceTelemetry(payload)) {
        throw new Error("The telemetry response was invalid.");
      }
      setSnapshotOverride(payload);
      setNow(tornNow());
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
      ? `Torn reports ${formatDuration(seconds)} of cooldown remaining. Live progress returns automatically when the next chain starts.`
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
  // Runtime is measured against the live clock, not the snapshot, so it keeps
  // moving between polls instead of freezing for the refresh interval.
  const elapsedSeconds = chain.startedAt > 0 ? Math.max(0, Math.floor(now / 1_000) - chain.startedAt) : 0;
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
          {/* Endpoints are read from Torn's `current` and `max`, so the scale
              re-derives itself whenever the faction's target changes. */}
          <div
            className={`chain-gauge${progress >= 100 ? " chain-gauge--complete" : ""}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={chain.maximum || undefined}
            aria-valuenow={chain.current}
            aria-valuetext={`${chain.current.toLocaleString()} of ${chain.maximum.toLocaleString()} hits`}
          >
            <div className="chain-gauge__track">
              <div className="chain-gauge__fill" style={{ width: `${progress}%` }}><span className="chain-gauge__sheen" aria-hidden="true" /></div>
              {[25, 50, 75].map((value) => <i key={value} className="chain-gauge__tick" style={{ left: `${value}%` }} aria-hidden="true" />)}
              <span className="chain-gauge__marker" style={{ left: `${progress}%` }} aria-hidden="true"><b>{chain.current.toLocaleString()}</b></span>
            </div>
            <div className="chain-gauge__scale" aria-hidden="true">
              <span>0</span>
              <span className="chain-gauge__scale-mid"><b>{progress.toFixed(1)}%</b> to the next bonus · {remaining.toLocaleString()} hit{remaining === 1 ? "" : "s"} to go</span>
              <span>{chain.maximum.toLocaleString()}</span>
            </div>
            <ol className="chain-milestones" aria-label="Torn chain bonus milestones">
              {milestoneWindow(chain.maximum).map((milestone) => {
                const reached = chain.current >= milestone;
                const target = milestone === chain.maximum;
                return <li key={milestone} className={`chain-milestone${reached ? " chain-milestone--reached" : ""}${target ? " chain-milestone--target" : ""}`}>
                  <i aria-hidden="true" />
                  <b>{milestone.toLocaleString()}</b>
                  {target && <em>next bonus</em>}
                </li>;
              })}
            </ol>
          </div>
          <div className="chain-console__pace"><TrendingUp size={14} /><span>Torn chain modifier</span><strong>{chain.modifier.toFixed(2)}×</strong><em>Live member totals require a matching chain report</em></div>
        </div>

        <TimeoutRing seconds={seconds} windowSeconds={timeoutWindow} deadline={chain.timeoutAt} />
      </div>

      <div className="chain-console__metrics">
        <div><span><Users size={17} /></span><small>Faction members</small><strong>{factionMembers || "—"}</strong><p>From faction basic endpoint</p></div>
        <div><span><Crosshair size={17} /></span><small>Next bonus at</small><strong>{chain.maximum.toLocaleString()}<em> hits</em></strong><p>Torn chain bonus target</p></div>
        <div><span><Activity size={17} /></span><small>Elapsed runtime</small><strong>{formatDuration(elapsedSeconds)}</strong><p>Started {formatTornTime(chain.startedAt)}</p></div>
        <div><span className="chain-metric__symbol">✓</span><small>Data provenance</small><strong>Live<em> API</em></strong><p>Validated server-side</p></div>
      </div>
    </section>
  );
}

/**
 * Torn's `timeout` and `cooldown` are seconds remaining at the moment of the
 * check, so the live value is that figure minus however long ago the snapshot
 * was taken.
 */
/**
 * The countdown ring. The sweep is driven by `stroke-dashoffset`, which the
 * browser interpolates natively, so it glides rather than stepping once a
 * second, and the scale comes from the widest timeout Torn has reported for
 * this chain rather than an assumed window.
 */
function TimeoutRing({ seconds, windowSeconds, deadline }: { seconds: number; windowSeconds: number; deadline: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const fraction = windowSeconds > 0 ? Math.max(0, Math.min(1, seconds / windowSeconds)) : 0;
  const tone = seconds <= 0 ? "expired" : seconds < 60 ? "critical" : seconds < 120 ? "warning" : "safe";
  const label = tone === "expired" ? "Chain dropped" : tone === "critical" ? "Act now" : tone === "warning" ? "Watch window" : "Healthy";

  return (
    <aside className={`timeout-ring timeout-ring--${tone}`} aria-label="Chain timeout">
      <header className="timeout-ring__header">
        <span><Clock3 size={14} aria-hidden="true" /> Chain timeout</span>
        <em className="timeout-ring__badge">{label}</em>
      </header>

      <div className="timeout-ring__dial">
        <svg viewBox="0 0 128 128" aria-hidden="true">
          <defs>
            <linearGradient id="timeout-ring-sweep" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--ring-from)" />
              <stop offset="100%" stopColor="var(--ring-colour)" />
            </linearGradient>
          </defs>
          <circle className="timeout-ring__track" cx="64" cy="64" r={radius} />
          {/* A sixty-mark bezel inside the track. It reads as an instrument
              scale rather than the four stray spokes it replaces, and gives the
              eye something to measure the arc against. */}
          <g className="timeout-ring__bezel">
            {Array.from({ length: 60 }, (_, index) => {
              const angle = (index * 6 * Math.PI) / 180;
              const major = index % 5 === 0;
              const inner = major ? 38.5 : 41;
              return <line
                key={index}
                className={major ? "timeout-ring__mark timeout-ring__mark--major" : "timeout-ring__mark"}
                x1={64 + inner * Math.cos(angle)}
                y1={64 + inner * Math.sin(angle)}
                x2={64 + 44 * Math.cos(angle)}
                y2={64 + 44 * Math.sin(angle)}
              />;
            })}
          </g>
          <circle
            className="timeout-ring__sweep"
            cx="64"
            cy="64"
            r={radius}
            stroke="url(#timeout-ring-sweep)"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
          />
          {/* A head on the sweep reads as a clock hand, so movement is obvious
              even when a single second barely changes the arc. */}
          {fraction > 0 && <>
            <circle
              className="timeout-ring__halo"
              cx={64 + radius * Math.cos(fraction * 2 * Math.PI)}
              cy={64 + radius * Math.sin(fraction * 2 * Math.PI)}
              r={8}
            />
            <circle
              className="timeout-ring__head"
              cx={64 + radius * Math.cos(fraction * 2 * Math.PI)}
              cy={64 + radius * Math.sin(fraction * 2 * Math.PI)}
              r={3.4}
            />
          </>}
        </svg>
        <div className="timeout-ring__readout" role="timer" aria-live="off">
          <strong>{formatTime(seconds)}</strong>
          <span>remaining</span>
        </div>
      </div>

      <dl className="timeout-ring__facts">
        <div><dt>Drops at</dt><dd>{deadline > 0 ? formatTornTime(deadline) : "—"}</dd></div>
        <div><dt>Window</dt><dd>{formatDuration(windowSeconds)}</dd></div>
      </dl>
      <small title="Torn reports seconds remaining at the moment it answers. Chainward anchors the deadline to Torn's own clock and re-syncs every 10 seconds while a chain runs.">
        Anchored to Torn&apos;s clock · every hit restarts the window
      </small>
    </aside>
  );
}

function remainingSeconds(telemetry: WorkspaceTelemetry, nowMs: number): number {
  const chain = telemetry.chain;
  if (!chain) return 0;
  const deadline = chain.state === "cooldown" ? chain.cooldownAt : chain.state === "active" ? chain.timeoutAt : 0;
  if (deadline <= 0) return 0;
  return Math.max(0, deadline - Math.floor(nowMs / 1_000));
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
