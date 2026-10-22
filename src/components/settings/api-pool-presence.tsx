"use client";

import { useEffect } from "react";

export function ApiPoolPresence({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let pending = false;
    let activeRequest: AbortController | null = null;
    const heartbeat = async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || pending) return;
      pending = true;
      const controller = new AbortController();
      activeRequest = controller;
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      try {
        await fetch("/api/settings/api-pool/presence", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal });
      } catch {
        return;
      } finally {
        window.clearTimeout(timeout);
        activeRequest = null;
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
      activeRequest?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [enabled]);
  return null;
}
