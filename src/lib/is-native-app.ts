"use client";

/**
 * True inside the Capacitor Android shell, false in any regular browser tab.
 * Several client-only behaviours branch on this: WebView Credential Manager
 * quirks (connect-form.tsx), and here, which push transport a device can
 * actually use - the WebView can't be reliably woken by Web Push once
 * closed, so it registers an FCM token instead.
 */
export function isNativeApp(): boolean {
  try { return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()); } catch { return false; }
}
