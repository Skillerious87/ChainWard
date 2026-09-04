"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  anchorFromReading,
  createAnchor,
  displaySeconds,
  project,
  rebaseAnchor,
  reconcileChainReading,
  type CountdownAnchor,
} from "@/lib/torn/chain-countdown";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";

interface ServerClockAnchor {
  wallMs: number;
  atPerf: number;
}

interface CountdownView {
  remainingMs: number;
  deadlineAtSeconds: number;
  nowSeconds: number;
}

export interface LiveWorkspaceTelemetryValue {
  telemetry: WorkspaceTelemetry;
  seconds: number;
  deadlineAtSeconds: number;
  nowSeconds: number;
}

const LiveWorkspaceTelemetryContext = createContext<LiveWorkspaceTelemetryValue | null>(null);

export function LiveWorkspaceTelemetryProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: LiveWorkspaceTelemetryValue;
}) {
  return <LiveWorkspaceTelemetryContext.Provider value={value}>{children}</LiveWorkspaceTelemetryContext.Provider>;
}

/**
 * Reads the countdown owned by the persistent application shell.
 *
 * Route components are deliberately consumers, never owners, of this clock.
 * Next can unmount and recreate a page while the surrounding layout remains;
 * keeping the monotonic anchor in that layout prevents a route remount from
 * treating `performance.now() === 0` as the time the new component appeared.
 */
export function useLiveWorkspaceTelemetry(): LiveWorkspaceTelemetryValue {
  const value = useContext(LiveWorkspaceTelemetryContext);
  if (!value) throw new Error("Live workspace telemetry must be used inside AppShell.");
  return value;
}

/**
 * One monotonic countdown for the lifetime of the authenticated app shell.
 * `applyReading` accepts each network observation with its measured transit
 * time; the returned view keeps advancing even while route children change.
 */
export function usePersistentChainCountdown(snapshot: WorkspaceTelemetry): {
  seconds: number;
  deadlineAtSeconds: number;
  nowSeconds: number;
  applyReading: (telemetry: WorkspaceTelemetry, transitMs: number) => void;
} {
  const chainKey = chainReadingKey(snapshot);
  const initialReportedMs = reportedRemainingMs(snapshot);
  const initialRemainingMs = anchorFromReading(initialReportedMs, snapshot.dataAgeMs ?? 0, 0, 0).remainingMs;
  const initialServerMs = telemetryServerTimeMs(snapshot);
  const [view, setView] = useState<CountdownView>(() => ({
    remainingMs: initialRemainingMs,
    deadlineAtSeconds: Math.floor((initialServerMs + initialRemainingMs) / 1_000),
    nowSeconds: Math.floor(initialServerMs / 1_000),
  }));
  const stateRef = useRef<{
    anchor: CountdownAnchor;
    clock: ServerClockAnchor;
    key: string;
    current: number;
  }>({
    anchor: createAnchor(initialRemainingMs, 0),
    clock: { wallMs: initialServerMs, atPerf: 0 },
    key: chainKey,
    current: snapshot.chain?.current ?? 0,
  });
  const hydratedRef = useRef(false);
  const appliedSnapshotRef = useRef(telemetryFingerprint(snapshot));

  const applyReading = useCallback((telemetry: WorkspaceTelemetry, transitMs: number) => {
    const nowPerf = performance.now();
    const incoming = anchorFromReading(
      reportedRemainingMs(telemetry),
      telemetry.dataAgeMs ?? 0,
      transitMs,
      nowPerf,
    );
    const previous = stateRef.current;
    const reconciled = reconcileChainReading(previous, {
      anchor: incoming,
      key: chainReadingKey(telemetry),
      current: telemetry.chain?.current ?? 0,
    }, nowPerf);
    const parsedServerMs = telemetryServerTimeMs(telemetry);
    const clock = Number.isFinite(parsedServerMs)
      ? { wallMs: parsedServerMs + Math.max(0, transitMs), atPerf: nowPerf }
      : previous.clock;

    stateRef.current = { ...reconciled, clock };
    appliedSnapshotRef.current = telemetryFingerprint(telemetry);
    setView(projectCountdownView(stateRef.current, nowPerf));
  }, []);

  useEffect(() => {
    // The browser navigation clock may already be minutes old when a nested
    // route first mounts. Rebase once at hydration instead of subtracting the
    // whole document lifetime from a newly received server duration.
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const nowPerf = performance.now();
    stateRef.current = {
      ...stateRef.current,
      anchor: rebaseAnchor(stateRef.current.anchor, nowPerf),
      clock: { ...stateRef.current.clock, atPerf: nowPerf },
    };
    setView(projectCountdownView(stateRef.current, nowPerf));
  }, []);

  useEffect(() => {
    // Poll events usually apply a reading before its React state is rendered.
    // This catches newer server props (for example router.refresh()) without
    // applying the same observation twice.
    if (telemetryFingerprint(snapshot) === appliedSnapshotRef.current) return;
    applyReading(snapshot, 0);
  }, [applyReading, snapshot]);

  useEffect(() => {
    function tick(): void {
      setView(projectCountdownView(stateRef.current, performance.now()));
    }
    const interval = window.setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  return useMemo(() => ({
    seconds: displaySeconds(view.remainingMs),
    deadlineAtSeconds: view.deadlineAtSeconds,
    nowSeconds: view.nowSeconds,
    applyReading,
  }), [applyReading, view]);
}

function chainReadingKey(telemetry: WorkspaceTelemetry): string {
  return `${telemetry.chain?.id ?? 0}:${telemetry.chain?.state ?? "none"}`;
}

function telemetryFingerprint(telemetry: WorkspaceTelemetry): string {
  return [
    telemetry.checkedAt,
    telemetry.dataAgeMs ?? 0,
    chainReadingKey(telemetry),
    telemetry.chain?.current ?? 0,
    telemetry.chain?.timeoutSeconds ?? 0,
    telemetry.chain?.cooldownSeconds ?? 0,
  ].join(":");
}

/** Remaining duration Torn reported for whichever countdown is running. */
function reportedRemainingMs(telemetry: WorkspaceTelemetry): number {
  const chain = telemetry.chain;
  if (!chain) return 0;
  if (chain.state === "cooldown") return chain.cooldownSeconds * 1_000;
  if (chain.state === "active") return chain.timeoutSeconds * 1_000;
  return 0;
}

function telemetryServerTimeMs(telemetry: WorkspaceTelemetry): number {
  const parsed = Date.parse(telemetry.checkedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function projectCountdownView(
  state: { anchor: CountdownAnchor; clock: ServerClockAnchor },
  nowPerf: number,
): CountdownView {
  const remainingMs = project(state.anchor, nowPerf);
  const serverNowMs = state.clock.wallMs + Math.max(0, nowPerf - state.clock.atPerf);
  return {
    remainingMs,
    deadlineAtSeconds: Math.floor((serverNowMs + remainingMs) / 1_000),
    nowSeconds: Math.floor(serverNowMs / 1_000),
  };
}
