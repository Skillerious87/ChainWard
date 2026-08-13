"use client";

import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PageLoadingCore } from "@/components/ui/page-loading-core";

const NAVIGATION_EVENT = "chainward:navigating";
const MINIMUM_VISIBLE_MS = 1_000;
const FINISH_DURATION_MS = 260;
const NAVIGATION_SAFETY_TIMEOUT_MS = 12_000;

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
 * Client-only panes (settings sections, editor tabs, and similar views) render
 * synchronously, but still deserve the same visible acknowledgement as a route
 * change. RouteProgress owns the minimum display time, so callers only need to
 * publish for the duration of the render frame.
 */
export function publishViewSwitch(id: string): void {
  publishNavigationState(id, true);
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => publishNavigationState(id, false)));
}

/**
 * Immediate workspace navigation feedback. `useLinkStatus` deliberately skips
 * prefetched routes, so a capture listener also observes ordinary same-origin
 * link activation. The ring stays visible long enough to be perceived even
 * when the destination was already in the Next.js client cache.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"idle" | "running" | "finishing">("idle");
  const pendingIds = useRef(new Set<string>());
  const manualNavigationId = useRef<string | null>(null);
  const manualSafetyTimer = useRef<number | undefined>(undefined);
  const runningSince = useRef(0);

  useEffect(() => {
    let finishDelayTimer: number | undefined;
    let idleTimer: number | undefined;

    /**
     * The outgoing view stays on screen while the next one resolves, so it is
     * marked on the root element instead of being replaced by a placeholder.
     */
    function markNavigating(active: boolean): void {
      if (!active) {
        delete document.documentElement.dataset.navigating;
        return;
      }
      document.documentElement.dataset.navigating = "true";
    }

    function receive(event: Event): void {
      const detail = (event as CustomEvent<{ id: string; pending: boolean }>).detail;
      if (!detail || typeof detail.id !== "string") return;
      if (detail.pending) pendingIds.current.add(detail.id);
      else pendingIds.current.delete(detail.id);

      if (pendingIds.current.size > 0) {
        window.clearTimeout(finishDelayTimer);
        window.clearTimeout(idleTimer);
        if (runningSince.current === 0) runningSince.current = performance.now();
        markNavigating(true);
        setPhase("running");
        return;
      }

      const remaining = Math.max(0, MINIMUM_VISIBLE_MS - (performance.now() - runningSince.current));
      window.clearTimeout(finishDelayTimer);
      finishDelayTimer = window.setTimeout(() => {
        setPhase((current) => current === "idle" ? current : "finishing");
        idleTimer = window.setTimeout(() => {
          runningSince.current = 0;
          markNavigating(false);
          setPhase("idle");
        }, FINISH_DURATION_MS);
      }, remaining);
    }

    window.addEventListener(NAVIGATION_EVENT, receive);
    return () => {
      window.clearTimeout(finishDelayTimer);
      window.clearTimeout(idleTimer);
      delete document.documentElement.dataset.navigating;
      window.removeEventListener(NAVIGATION_EVENT, receive);
    };
  }, []);

  useEffect(() => {
    function completeManualNavigation(): void {
      const id = manualNavigationId.current;
      if (!id) return;
      manualNavigationId.current = null;
      window.clearTimeout(manualSafetyTimer.current);
      manualSafetyTimer.current = undefined;
      publishNavigationState(id, false);
    }

    function captureNavigation(event: MouseEvent): void {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const current = new URL(window.location.href);
      // Query/hash-only links do not replace a workspace view, and pathname is
      // the completion signal available without forcing a search-param
      // Suspense boundary around the persistent shell.
      if (destination.pathname === current.pathname) return;

      completeManualNavigation();
      const id = `link:${destination.pathname}${destination.search}:${performance.now()}`;
      manualNavigationId.current = id;
      publishNavigationState(id, true);
      manualSafetyTimer.current = window.setTimeout(completeManualNavigation, NAVIGATION_SAFETY_TIMEOUT_MS);
    }

    document.addEventListener("click", captureNavigation, true);
    return () => {
      document.removeEventListener("click", captureNavigation, true);
      completeManualNavigation();
    };
  }, []);

  useEffect(() => {
    const id = manualNavigationId.current;
    if (!id) return;
    manualNavigationId.current = null;
    window.clearTimeout(manualSafetyTimer.current);
    manualSafetyTimer.current = undefined;
    publishNavigationState(id, false);
  }, [pathname]);

  return <>
    <div className="route-progress" data-phase={phase} aria-hidden="true" />
    {phase !== "idle" && <div className="route-loading-core" data-phase={phase}><PageLoadingCore title="Loading" hint="Preparing the next view" /></div>}
  </>;
}
