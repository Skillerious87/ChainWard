"use client";

import { useEffect } from "react";
import { markNativeSplashHidden } from "@/lib/native-splash-state";

/**
 * Inside the Capacitor Android wrapper, MainActivity keeps a custom animated
 * splash overlay up (with an 8s native safety timer as a fallback) until this
 * fires, so the logo/wordmark never drops away before the live site is
 * actually ready to show. No-op in a normal browser tab, where
 * `window.Capacitor` is absent.
 *
 * The native `hide()` call resolves only once the overlay has actually been
 * removed (see MainActivity.hideNativeSplash), so awaiting it before calling
 * markNativeSplashHidden() is what lets connect-form.tsx's auto-unlock effect
 * know it's safe to raise the biometric prompt without it appearing on top of
 * a still-visible splash.
 */
export function NativeSplashHide() {
  useEffect(() => {
    const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { AppSplash?: { hide?: () => Promise<void> } } } }).Capacitor;
    if (capacitor?.isNativePlatform?.()) {
      Promise.resolve(capacitor.Plugins?.AppSplash?.hide?.())
        .catch(() => {})
        .finally(() => markNativeSplashHidden());
    } else {
      markNativeSplashHidden();
    }
  }, []);

  return null;
}
