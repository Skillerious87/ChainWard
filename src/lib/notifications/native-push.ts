"use client";

import { PushNotifications } from "@capacitor/push-notifications";
import { isNativeApp } from "@/lib/is-native-app";
import type { PushNotificationPreferences } from "./push-types";

/**
 * The Capacitor Android app's counterpart to the browser Web Push flow in
 * member-notification-preferences.ts - registers an FCM device token
 * instead of a browser PushSubscription, since the WebView can't reliably be
 * woken by Web Push once the app is closed. Everything downstream
 * (preferences, dispatch, quiet hours) is shared with the web path; only how
 * a device identifies itself to the server differs.
 */
const TOKEN_STORAGE_KEY = "chainward:fcm-token";
const REGISTRATION_TIMEOUT_MS = 15_000;

export function nativePushSupported(): boolean {
  return isNativeApp();
}

/** Mirrors the web `NotificationPermission` shape so Settings can render one status UI regardless of transport. */
export async function nativePushPermissionStatus(): Promise<"default" | "denied" | "granted" | "unsupported"> {
  if (!isNativeApp()) return "unsupported";
  const status = await PushNotifications.checkPermissions().catch(() => null);
  if (!status) return "unsupported";
  if (status.receive === "granted") return "granted";
  if (status.receive === "denied") return "denied";
  return "default";
}

function cachedToken(): string | null {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY); } catch { return null; }
}

function cacheToken(token: string): void {
  try { localStorage.setItem(TOKEN_STORAGE_KEY, token); } catch { /* the token still registers server-side this session */ }
}

function clearCachedToken(): void {
  try { localStorage.removeItem(TOKEN_STORAGE_KEY); } catch { /* best-effort */ }
}

/** Resolves with the FCM token once the native side reports one - must be wired up before calling `register()`, or the event can fire unheard. */
function awaitRegistrationToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Timed out waiting for a push registration token."));
    }, REGISTRATION_TIMEOUT_MS);
    void PushNotifications.addListener("registration", (token) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(token.value);
    });
    void PushNotifications.addListener("registrationError", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(error.error || "Push registration failed."));
    });
  });
}

export async function registerNativePushDevice(preferences: PushNotificationPreferences): Promise<void> {
  if (!isNativeApp()) throw new Error("Native push notifications are only available inside the Chainward app.");
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive !== "granted") permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") throw new Error("Notification permission was not granted.");
  const tokenPromise = awaitRegistrationToken();
  await PushNotifications.register();
  const token = await tokenPromise;
  cacheToken(token);
  await saveDeviceToken(token, preferences);
}

export async function syncNativePushPreferences(preferences: PushNotificationPreferences): Promise<boolean> {
  const token = cachedToken();
  if (!token) return false;
  await saveDeviceToken(token, preferences);
  return true;
}

export async function unregisterNativePushDevice(): Promise<void> {
  const token = cachedToken();
  if (token) {
    await fetch("/api/notifications/push/fcm", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => undefined);
  }
  await PushNotifications.unregister().catch(() => undefined);
  clearCachedToken();
}

export async function testNativePushNotification(): Promise<void> {
  const token = cachedToken();
  if (!token) throw new Error("Enable notifications on this device first.");
  const response = await fetch("/api/notifications/push/fcm/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload, "The server could not send the test notification."));
}

export function hasActiveNativePushRegistration(): boolean {
  return Boolean(cachedToken());
}

async function saveDeviceToken(token: string, preferences: PushNotificationPreferences): Promise<void> {
  const response = await fetch("/api/notifications/push/fcm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      preferences,
      platform: "Android",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload, "The server could not save this device registration."));
}

function errorMessage(value: unknown, fallback: string): string {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : fallback;
}
