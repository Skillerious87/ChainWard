"use client";

import { useEffect } from "react";

export function ApiPoolPresence({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let pending = false;
    const heartbeat = async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || pending) return;
      pending = true;
      try {
        await fetch("/api/settings/api-pool/presence", { method: "POST", credentials: "same-origin", cache: "no-store" });
      } catch {
        return;
      } finally {
        pending = false;
      }
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 15_000);
    const resume = () => void heartbeat();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [enabled]);
  return null;
}
