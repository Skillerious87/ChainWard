"use client";

import { useSyncExternalStore } from "react";
import {
  defaultPushNotificationPreferences,
  type PushNotificationIntervalMinutes,
  type PushNotificationLevel,
  type PushNotificationPreferences,
  type PushNotificationReminderHours,
  type StoredPushSubscription,
} from "@/lib/notifications/push-types";

export type MemberNotificationLevel = PushNotificationLevel;
export type MemberNotificationIntervalMinutes = PushNotificationIntervalMinutes;
export type MemberNotificationReminderHours = PushNotificationReminderHours;
export type BrowserNotificationPermission = NotificationPermission | "unsupported";
export type MemberNotificationPreferences = PushNotificationPreferences;

const storageKey = "chainward:member-notifications:v1";
const changeEvent = "chainward:member-notifications";

export const defaultMemberNotificationPreferences: MemberNotificationPreferences = defaultPushNotificationPreferences;

let currentSnapshot = defaultMemberNotificationPreferences;
let snapshotLoaded = false;

export function useMemberNotificationPreferences(): MemberNotificationPreferences {
  return useSyncExternalStore(subscribe, browserSnapshot, () => defaultMemberNotificationPreferences);
}

export function readMemberNotificationPreferences(): MemberNotificationPreferences {
  if (typeof window === "undefined") return defaultMemberNotificationPreferences;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (!value || typeof value !== "object") return defaultMemberNotificationPreferences;
    const candidate = value as Partial<MemberNotificationPreferences>;
    return {
      enabled: candidate.enabled === true,
      includeChainAlerts: candidate.includeChainAlerts !== false,
      chainWarningSeconds: isChainWarning(candidate.chainWarningSeconds) ? candidate.chainWarningSeconds : defaultMemberNotificationPreferences.chainWarningSeconds,
      minimumLevel: candidate.minimumLevel === "critical" ? "critical" : "attention",
      intervalMinutes: isInterval(candidate.intervalMinutes) ? candidate.intervalMinutes : defaultMemberNotificationPreferences.intervalMinutes,
      reminderHours: isReminder(candidate.reminderHours) ? candidate.reminderHours : defaultMemberNotificationPreferences.reminderHours,
      includeWatchList: candidate.includeWatchList !== false,
      includeExpiredHolidays: candidate.includeExpiredHolidays !== false,
      keepCriticalVisible: candidate.keepCriticalVisible !== false,
      quietHoursEnabled: candidate.quietHoursEnabled !== false,
      quietStart: isTime(candidate.quietStart) ? candidate.quietStart : defaultMemberNotificationPreferences.quietStart,
      quietEnd: isTime(candidate.quietEnd) ? candidate.quietEnd : defaultMemberNotificationPreferences.quietEnd,
    };
  } catch {
    return defaultMemberNotificationPreferences;
  }
}

export function saveMemberNotificationPreferences(patch: Partial<MemberNotificationPreferences>): MemberNotificationPreferences {
  const preferences = { ...readMemberNotificationPreferences(), ...patch };
  currentSnapshot = preferences;
  snapshotLoaded = true;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    // The preference still applies to this tab when browser storage is blocked.
  }
  window.dispatchEvent(new CustomEvent<MemberNotificationPreferences>(changeEvent, { detail: preferences }));
  return preferences;
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window) || !window.isSecureContext) return "unsupported";
  return Notification.requestPermission();
}

export async function ensureNotificationWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) return null;
  try {
    await navigator.serviceWorker.register("/chainward-notifications.js", { scope: "/" });
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function showDeviceNotification(title: string, options: NotificationOptions): Promise<boolean> {
  if (getBrowserNotificationPermission() !== "granted") return false;
  const registration = await ensureNotificationWorker();
  try {
    if (registration) {
      await registration.showNotification(title, options);
      return true;
    }
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

/** Backward-compatible name for the foreground member monitor. */
export const showWindowsNotification = showDeviceNotification;

export async function subscribeDeviceNotifications(preferences: MemberNotificationPreferences): Promise<PushSubscription> {
  const registration = await ensureNotificationWorker();
  if (!registration || !("PushManager" in window) || !("pushManager" in registration)) {
    throw new Error("This browser does not support Web Push in the current installation mode.");
  }
  const statusResponse = await fetch("/api/notifications/push", { headers: { accept: "application/json" }, cache: "no-store" });
  const status: unknown = await statusResponse.json().catch(() => null);
  if (!statusResponse.ok || !isPushStatus(status) || !status.available || !status.publicKey) {
    throw new Error(errorMessage(status, "Background notifications are not configured on this deployment."));
  }
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeApplicationServerKey(status.publicKey),
  });
  await saveDeviceSubscription(subscription, preferences);
  return subscription;
}

export async function syncDeviceNotificationPreferences(preferences: MemberNotificationPreferences): Promise<boolean> {
  const registration = await ensureNotificationWorker();
  if (!registration || !("pushManager" in registration)) return false;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  await saveDeviceSubscription(subscription, preferences);
  return true;
}

export async function unsubscribeDeviceNotifications(): Promise<void> {
  const registration = await ensureNotificationWorker();
  if (!registration || !("pushManager" in registration)) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await fetch("/api/notifications/push", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe();
}

export async function testDevicePushNotification(): Promise<void> {
  const registration = await ensureNotificationWorker();
  const subscription = registration && "pushManager" in registration
    ? await registration.pushManager.getSubscription()
    : null;
  if (!subscription) throw new Error("Enable notifications on this device first.");
  const response = await fetch("/api/notifications/push/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload, "The server could not send the test notification."));
}

export async function hasActivePushSubscription(): Promise<boolean> {
  const registration = await ensureNotificationWorker();
  return Boolean(registration && "pushManager" in registration && await registration.pushManager.getSubscription());
}

export function deviceInstallGuidance(): "ios-install" | "unsupported" | null {
  if (typeof navigator === "undefined" || typeof window === "undefined") return "unsupported";
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = navigatorWithStandalone.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  if (ios && !standalone) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !window.isSecureContext) return "unsupported";
  return null;
}

export function isNotificationQuietTime(preferences: MemberNotificationPreferences, date = new Date()): boolean {
  if (!preferences.quietHoursEnabled) return false;
  const current = date.getHours() * 60 + date.getMinutes();
  const start = timeMinutes(preferences.quietStart);
  const end = timeMinutes(preferences.quietEnd);
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener(changeEvent, onStoreChange);
  return () => window.removeEventListener(changeEvent, onStoreChange);
}

function browserSnapshot(): MemberNotificationPreferences {
  if (!snapshotLoaded) {
    currentSnapshot = readMemberNotificationPreferences();
    snapshotLoaded = true;
  }
  return currentSnapshot;
}

function isInterval(value: unknown): value is MemberNotificationIntervalMinutes {
  return value === 5 || value === 15 || value === 30 || value === 60;
}

function isReminder(value: unknown): value is MemberNotificationReminderHours {
  return value === 0 || value === 4 || value === 12 || value === 24;
}

function isChainWarning(value: unknown): value is MemberNotificationPreferences["chainWarningSeconds"] {
  return value === 60 || value === 120 || value === 180 || value === 300;
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeMinutes(value: string): number {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

async function saveDeviceSubscription(subscription: PushSubscription, preferences: MemberNotificationPreferences): Promise<void> {
  const serialized = subscription.toJSON();
  const stored: StoredPushSubscription = {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: {
      p256dh: serialized.keys?.p256dh ?? "",
      auth: serialized.keys?.auth ?? "",
    },
  };
  if (!stored.keys.p256dh || !stored.keys.auth) throw new Error("The browser returned incomplete push key material.");
  const response = await fetch("/api/notifications/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subscription: stored,
      preferences,
      platform: devicePlatformLabel(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload, "The server could not save this device subscription."));
}

function decodeApplicationServerKey(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = window.atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer;
}

function devicePlatformLabel(): string {
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iOS";
  if (/Android/i.test(navigator.userAgent)) return "Android";
  return navigator.platform || "Browser";
}

function isPushStatus(value: unknown): value is { available: boolean; publicKey: string | null } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { available?: unknown; publicKey?: unknown };
  return typeof candidate.available === "boolean" && (candidate.publicKey === null || typeof candidate.publicKey === "string");
}

function errorMessage(value: unknown, fallback: string): string {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : fallback;
}
