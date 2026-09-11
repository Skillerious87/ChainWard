"use client";

import { Share, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";

const DISMISSED_KEY = "chainward-install-dismissed";
const NARROW_VIEWPORT_QUERY = "(max-width: 560px)";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type PromptVariant = "android" | "ios";

/**
 * The manifest (`src/app/manifest.ts`) is already installable - this just
 * invites mobile visitors to actually do it, since nothing else on the page
 * would tell them it's possible.
 */
export function InstallPrompt() {
  const [variant, setVariant] = useState<PromptVariant | null>(null);
  // Only ever affects visibility once `variant` is set by the effect below
  // (client-only, post-hydration), so reading localStorage here up front
  // can't cause a server/client markup mismatch.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try { return localStorage.getItem(DISMISSED_KEY) === "1"; } catch { return false; }
  });
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const alreadyStandalone = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    if (alreadyStandalone) return;

    if (!window.matchMedia(NARROW_VIEWPORT_QUERY).matches) return;

    const userAgent = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(userAgent) && !/crios|fxios/i.test(userAgent);
    if (isIOS) {
      queueMicrotask(() => setVariant("ios"));
      return;
    }

    function onBeforeInstallPrompt(event: Event): void {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setVariant("android");
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  function dismiss(): void {
    setDismissed(true);
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* private browsing - dismissal just won't persist */ }
  }

  async function install(): Promise<void> {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    dismiss();
  }

  if (!variant || dismissed) return null;

  return (
    <div className="install-nudge" role="status">
      <span className="install-nudge__icon" aria-hidden="true"><Smartphone size={18} /></span>
      <div className="install-nudge__body">
        {variant === "android" ? (
          <>
            <strong>Install Chainward</strong>
            <span>Add it to your home screen for one-tap, full-screen access.</span>
          </>
        ) : (
          <>
            <strong>Add to Home Screen</strong>
            <span>Tap <Share size={12} /> Share, then &quot;Add to Home Screen&quot;.</span>
          </>
        )}
      </div>
      {variant === "android" && <button type="button" className="button button--primary install-nudge__install" onClick={() => void install()}>Install</button>}
      <button type="button" className="install-nudge__dismiss" onClick={dismiss} aria-label="Dismiss"><X size={15} /></button>
    </div>
  );
}
