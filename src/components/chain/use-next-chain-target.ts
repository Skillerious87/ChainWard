"use client";

import { useEffect, useState } from "react";
import { useLiveWorkspaceTelemetry } from "@/components/shell/live-workspace-telemetry";
import { useAppearancePreferences } from "@/lib/appearance-preferences";
import type { BestChainTargetResult } from "@/lib/targets/best-target";

function requestNextTarget(signal: AbortSignal): Promise<BestChainTargetResult> {
  return fetch("/api/targets/next", {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  }).then(async (response) => {
    if (!response.ok) throw new Error("Target check unavailable");
    const result = await response.json() as BestChainTargetResult;
    if (typeof result.targetCount !== "number" ||
      (result.target !== null && (!Number.isSafeInteger(result.target?.tornUserId) || !Array.isArray(result.target?.reasons)))) {
      throw new Error("Invalid target response");
    }
    return result;
  });
}

/** One cancellable watcher; focus/visibility/hit changes never reuse an old request. */
export function watchNextChainTarget({ autoRefresh, onResult, onUnavailable }: {
  autoRefresh: boolean;
  onResult: (result: BestChainTargetResult) => void;
  onUnavailable: () => void;
}): () => void {
  const controller = new AbortController();
  let disposed = false;
  let checking = false;
  let queued = false;
  let lastStarted = -Infinity;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    if (disposed || !navigator.onLine || document.visibilityState !== "visible") return;
    if (checking) {
      // The same return commonly emits both events in one turn. Only queue
      // a follow-up if something happened after this request was under way.
      if (performance.now() - lastStarted >= 1_000) queued = true;
      return;
    }
    // Focus and visibility commonly fire together. Coalesce them without
    // dropping a hit/return event that arrives just after the previous check.
    const wait = 5_000 - (performance.now() - lastStarted);
    if (wait > 0) {
      if (scheduled === undefined) scheduled = setTimeout(() => { scheduled = undefined; check(); }, wait);
      return;
    }
    checking = true;
    lastStarted = performance.now();
    void requestNextTarget(controller.signal).then((result) => {
      if (!disposed) onResult(result);
    }).catch(() => {
      // Do not keep offering an old attack link when a fresh check fails.
      if (!disposed) onUnavailable();
    }).finally(() => {
      checking = false;
      if (queued && !disposed) { queued = false; check(); }
    });
  };
  // Also covers navigating back to a prefetched/cached Active Chain page.
  check();
  const interval = autoRefresh ? setInterval(check, 15_000) : undefined;
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  document.addEventListener("visibilitychange", check);
  return () => {
    disposed = true;
    controller.abort();
    clearInterval(interval);
    clearTimeout(scheduled);
    window.removeEventListener("focus", check);
    window.removeEventListener("online", check);
    document.removeEventListener("visibilitychange", check);
  };
}

/** Target checks are independent of the slower contributor report refresh. */
export function useNextChainTarget(refreshKey = 0): BestChainTargetResult | null {
  const { telemetry } = useLiveWorkspaceTelemetry();
  const { autoRefresh } = useAppearancePreferences();
  const [live, setLive] = useState<{ chainId: number | undefined; hits: number | undefined; refreshKey: number; result: BestChainTargetResult } | null>(null);
  const chainId = telemetry.chain?.id;
  const hits = telemetry.chain?.current;

  useEffect(() => watchNextChainTarget({
    autoRefresh,
    onResult: (result) => setLive({ chainId, hits, refreshKey, result }),
    onUnavailable: () => setLive({ chainId, hits, refreshKey, result: { target: null, targetCount: 0, verificationUnavailable: true } }),
  }), [refreshKey, chainId, hits, autoRefresh]);

  // Never offer the previous hit's attack link while its replacement is being
  // verified. A pending check is distinct from an empty target list.
  return live?.chainId === chainId && live?.hits === hits && live?.refreshKey === refreshKey ? live.result : null;
}
