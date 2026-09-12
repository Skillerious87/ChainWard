"use client";

import { useEffect } from "react";

/**
 * Inside the Capacitor Android wrapper, MainActivity keeps a custom animated
 * splash overlay up (with a 5s native safety timer as a fallback) until this
 * fires, so the logo/wordmark never drops away before the live site is
 * actually ready to show. No-op in a normal browser tab, where
 * `window.Capacitor` is absent.
 */
export function NativeSplashHide() {
  useEffect(() => {
    const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { AppSplash?: { hide?: () => void } } } }).Capacitor;
    if (capacitor?.isNativePlatform?.()) {
      capacitor.Plugins?.AppSplash?.hide?.();
    }
  }, []);

  return null;
}
