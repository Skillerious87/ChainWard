"use client";

import { isNativeApp } from "@/lib/is-native-app";

/**
 * Signals when the native Android splash overlay has been fully dismissed
 * (see MainActivity.hideNativeSplash's callback and native-splash-hide.tsx).
 * Anything that can pop an OS-level window over the WebView - most notably
 * the biometric auto-unlock prompt in connect-form.tsx - must wait on this
 * first: that prompt renders above every app window, including a still-
 * visible splash, so firing it too early looks like the splash "covering"
 * the fingerprint sheet instead of the other way around.
 */
let resolveHidden: (() => void) | null = null;
let hiddenPromise: Promise<void> | null = null;

function getHiddenPromise(): Promise<void> {
  if (!hiddenPromise) {
    hiddenPromise = new Promise<void>((resolve) => {
      resolveHidden = resolve;
    });
  }
  return hiddenPromise;
}

export function markNativeSplashHidden(): void {
  getHiddenPromise();
  resolveHidden?.();
}

export function waitForNativeSplashHidden(): Promise<void> {
  if (!isNativeApp()) return Promise.resolve();
  return getHiddenPromise();
}
