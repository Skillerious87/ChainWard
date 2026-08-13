"use client";

import { useSyncExternalStore } from "react";

export type MemberNotificationLevel = "attention" | "critical";
export type MemberNotificationIntervalMinutes = 5 | 15 | 30 | 60;
export type MemberNotificationReminderHours = 0 | 4 | 12 | 24;
export type BrowserNotificationPermission = NotificationPermission | "unsupported";

export interface MemberNotificationPreferences {
  enabled: boolean;
  minimumLevel: MemberNotificationLevel;
  intervalMinutes: MemberNotificationIntervalMinutes;
  reminderHours: MemberNotificationReminderHours;
  includeWatchList: boolean;
  includeExpiredHolidays: boolean;
  keepCriticalVisible: boolean;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}

const storageKey = "chainward:member-notifications:v1";
const changeEvent = "chainward:member-notifications";

export const defaultMemberNotificationPreferences: MemberNotificationPreferences = {
  enabled: false,
  minimumLevel: "attention",
  intervalMinutes: 15,
  reminderHours: 12,
  includeWatchList: true,
  includeExpiredHolidays: true,
  keepCriticalVisible: true,
  quietHoursEnabled: true,
  quietStart: "23:00",
  quietEnd: "08:00",
};

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

export async function showWindowsNotification(title: string, options: NotificationOptions): Promise<boolean> {
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

function isTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeMinutes(value: string): number {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
