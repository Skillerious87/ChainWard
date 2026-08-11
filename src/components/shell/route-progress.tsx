"use client";

import { useLinkStatus } from "next/link";
import { useEffect, useRef, useState } from "react";

const NAVIGATION_EVENT = "chainward:navigating";

/**
 * Rendered inside a `<Link>`. `useLinkStatus` only reports the pending state to
 * descendants of the link that owns it, so each destination reports its own
 * state and the shell aggregates them into one progress bar.
 */
export function NavigationBeacon({ id }: { id: string }) {
  const { pending } = useLinkStatus();
  const announced = useRef(false);

  useEffect(() => {
    if (pending === announced.current) return;
    announced.current = pending;
    window.dispatchEvent(new CustomEvent<{ id: string; pending: boolean }>(NAVIGATION_EVENT, { detail: { id, pending } }));
    return () => {
      if (!announced.current) return;
      announced.current = false;
      window.dispatchEvent(new CustomEvent<{ id: string; pending: boolean }>(NAVIGATION_EVENT, { detail: { id, pending: false } }));
    };
  }, [id, pending]);

  return <i className="nav-item__pending" data-pending={pending ? "true" : "false"} aria-hidden="true" />;
}

export function publishNavigationState(id: string, pending: boolean): void {
  window.dispatchEvent(new CustomEvent<{ id: string; pending: boolean }>(NAVIGATION_EVENT, { detail: { id, pending } }));
}

/**
 * A thin indeterminate bar under the top chrome. It only becomes visible after
 * a short delay so instant, prefetched navigations do not flash a loading
 * state, and it always plays a completion sweep so the transition reads as
 * finished rather than cancelled.
 */
export function RouteProgress() {
  const [phase, setPhase] = useState<"idle" | "running" | "finishing">("idle");
  const pendingIds = useRef(new Set<string>());

  useEffect(() => {
    let finishTimer: number | undefined;
    let settleTimer: number | undefined;

    /**
     * The outgoing view stays on screen while the next one resolves, so it is
     * marked on the root element instead of being replaced by a placeholder.
     * The flag is delayed so an instant navigation never dims at all.
     */
    function markNavigating(active: boolean): void {
      window.clearTimeout(settleTimer);
      if (!active) {
        delete document.documentElement.dataset.navigating;
        return;
      }
      settleTimer = window.setTimeout(() => { document.documentElement.dataset.navigating = "true"; }, 140);
    }

    function receive(event: Event): void {
      const detail = (event as CustomEvent<{ id: string; pending: boolean }>).detail;
      if (!detail || typeof detail.id !== "string") return;
      if (detail.pending) pendingIds.current.add(detail.id);
      else pendingIds.current.delete(detail.id);

      if (pendingIds.current.size > 0) {
        window.clearTimeout(finishTimer);
        markNavigating(true);
        setPhase("running");
        return;
      }
      markNavigating(false);
      setPhase((current) => (current === "running" ? "finishing" : current));
      window.clearTimeout(finishTimer);
      finishTimer = window.setTimeout(() => setPhase("idle"), 420);
    }

    window.addEventListener(NAVIGATION_EVENT, receive);
    return () => {
      window.clearTimeout(finishTimer);
      window.clearTimeout(settleTimer);
      delete document.documentElement.dataset.navigating;
      window.removeEventListener(NAVIGATION_EVENT, receive);
    };
  }, []);

  return <div className="route-progress" data-phase={phase} role="presentation" />;
}
