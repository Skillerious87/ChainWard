"use client";

import { useLinkStatus } from "next/link";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";

const NAVIGATION_EVENT = "chainward:navigating";

/**
 * Rendered inside a `<Link>`. `useLinkStatus` only reports the pending state to
 * descendants of the link that owns it, so each destination reports its own
 * state and the shell aggregates them into a small spinner.
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

  return null;
}

export function publishNavigationState(id: string, pending: boolean): void {
  window.dispatchEvent(new CustomEvent<{ id: string; pending: boolean }>(NAVIGATION_EVENT, { detail: { id, pending } }));
}

/** Only actual pending navigation controls this spinner. No visibility timers. */
export function RouteProgress() {
  const [pending, setPending] = useState(false);
  const pendingIds = useRef(new Set<string>());

  useEffect(() => {
    function receive(event: Event): void {
      const detail = (event as CustomEvent<{ id: string; pending: boolean }>).detail;
      if (!detail || typeof detail.id !== "string" || typeof detail.pending !== "boolean") return;
      if (detail.pending) pendingIds.current.add(detail.id);
      else pendingIds.current.delete(detail.id);
      setPending(pendingIds.current.size > 0);
    }
    window.addEventListener(NAVIGATION_EVENT, receive);
    return () => window.removeEventListener(NAVIGATION_EVENT, receive);
  }, []);

  return pending ? <div className="route-spinner"><Spinner size={20} label="Loading page" /></div> : null;
}
