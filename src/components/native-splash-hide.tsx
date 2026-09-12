"use client";

import { useEffect } from "react";

/**
 * Inside the Capacitor Android wrapper, `capacitor.config.ts` keeps the native
 * splash screen up (with a generous auto-hide timer as a safety net) until this
 * fires, so the logo never drops away before the live site is actually ready
 * to show. No-op in a normal browser tab, where `window.Capacitor` is absent.
 */
export function NativeSplashHide() {
  useEffect(() => {
    const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { SplashScreen?: { hide?: () => void } } } }).Capacitor;
    if (capacitor?.isNativePlatform?.()) {
      capacitor.Plugins?.SplashScreen?.hide?.();
    }
  }, []);

  return null;
}
