"use client";

import { useEffect, useState } from "react";
import {
  ensureNotificationWorker,
  getBrowserNotificationPermission,
  isNotificationQuietTime,
  showWindowsNotification,
  useMemberNotificationPreferences,
  type MemberNotificationPreferences,
} from "@/lib/member-notification-preferences";
import type { MemberActivityAlert, MemberActivityMonitorSnapshot } from "@/lib/members/member-activity-intelligence";

const monitorStateKey = "chainward:member-monitor-state:v1";

interface MonitorNotificationState {
  factionId: number;
  fingerprint: string;
  notifiedAt: number;
}

export function useMemberActivityMonitor(initialSnapshot: MemberActivityMonitorSnapshot | null): MemberActivityMonitorSnapshot | null {
  const preferences = useMemberNotificationPreferences();
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  useEffect(() => {
    if (!preferences.enabled || !initialSnapshot) return;
    let stopped = false;
    let lastCheckedAt = 0;

    void ensureNotificationWorker();

    async function poll(): Promise<void> {
      if (!navigator.onLine) return;
      lastCheckedAt = Date.now();
      try {
        const response = await fetch("/api/members/activity-monitor", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        const payload: unknown = await response.json();
        if (!response.ok || !isMonitorSnapshot(payload) || stopped) return;
        setSnapshot(payload);
        await maybeNotify(payload, preferences);
      } catch {
        // Monitoring retains the most recent verified snapshot during transient failures.
      }
    }

    function checkOnResume(): void {
      if (document.visibilityState !== "visible" && navigator.onLine) return;
      if (Date.now() - lastCheckedAt < preferences.intervalMinutes * 60_000) return;
      void poll();
    }

    void poll();
    const interval = window.setInterval(() => void poll(), preferences.intervalMinutes * 60_000);
    document.addEventListener("visibilitychange", checkOnResume);
    window.addEventListener("online", checkOnResume);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", checkOnResume);
      window.removeEventListener("online", checkOnResume);
    };
  }, [initialSnapshot, preferences]);

  if (!initialSnapshot) return null;
  if (!snapshot || snapshot.factionId !== initialSnapshot.factionId) return initialSnapshot;
  return Date.parse(snapshot.checkedAt) > Date.parse(initialSnapshot.checkedAt) ? snapshot : initialSnapshot;
}

export function eligibleMemberAlerts(alerts: MemberActivityAlert[], preferences: MemberNotificationPreferences): MemberActivityAlert[] {
  return alerts.filter((alert) => {
    if (preferences.minimumLevel === "critical" && alert.severity !== "critical") return false;
    if (!preferences.includeWatchList && alert.trigger === "watch") return false;
    if (!preferences.includeExpiredHolidays && alert.trigger === "holiday-expired") return false;
    return true;
  });
}

async function maybeNotify(snapshot: MemberActivityMonitorSnapshot, preferences: MemberNotificationPreferences): Promise<void> {
  if (getBrowserNotificationPermission() !== "granted") return;
  const alerts = eligibleMemberAlerts(snapshot.alerts, preferences);
  const fingerprint = alerts.map((alert) => `${alert.tornUserId}:${alert.severity}:${alert.trigger}`).toSorted().join("|");
  const previous = readMonitorState(snapshot.factionId);
  const now = Date.now();

  if (!previous) {
    saveMonitorState({ factionId: snapshot.factionId, fingerprint, notifiedAt: now });
    return;
  }
  if (!fingerprint) {
    saveMonitorState({ factionId: snapshot.factionId, fingerprint: "", notifiedAt: now });
    return;
  }

  const reminderDue = preferences.reminderHours > 0 && now - previous.notifiedAt >= preferences.reminderHours * 3_600_000;
  if (fingerprint === previous.fingerprint && !reminderDue) return;
  if (isNotificationQuietTime(preferences)) return;

  const criticalCount = alerts.filter((alert) => alert.severity === "critical").length;
  const title = criticalCount
    ? `${criticalCount} critical member alert${criticalCount === 1 ? "" : "s"}`
    : `${alerts.length} member${alerts.length === 1 ? "" : "s"} need activity review`;
  const visibleNames = alerts.slice(0, 3).map((alert) => `${alert.memberName} (${Math.floor(alert.daysInactive)}d)`).join(", ");
  const body = `${snapshot.factionName}: ${visibleNames}${alerts.length > 3 ? ` and ${alerts.length - 3} more` : ""}.`;
  const shown = await showWindowsNotification(title, {
    body,
    icon: "/icons/android-chrome-192x192.png",
    badge: "/icons/favicon-32x32.png",
    tag: `chainward-member-activity-${snapshot.factionId}`,
    requireInteraction: criticalCount > 0 && preferences.keepCriticalVisible,
    data: { url: "/members?view=attention" },
  });
  if (shown) saveMonitorState({ factionId: snapshot.factionId, fingerprint, notifiedAt: now });
}

function readMonitorState(factionId: number): MonitorNotificationState | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(monitorStateKey) ?? "null");
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<MonitorNotificationState>;
    return candidate.factionId === factionId && typeof candidate.fingerprint === "string" && typeof candidate.notifiedAt === "number"
      ? candidate as MonitorNotificationState
      : null;
  } catch {
    return null;
  }
}

function saveMonitorState(state: MonitorNotificationState): void {
  try { window.localStorage.setItem(monitorStateKey, JSON.stringify(state)); }
  catch { /* Deduplication falls back to the current page lifetime when storage is blocked. */ }
}

function isMonitorSnapshot(value: unknown): value is MemberActivityMonitorSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MemberActivityMonitorSnapshot>;
  return typeof candidate.factionId === "number"
    && typeof candidate.factionName === "string"
    && typeof candidate.checkedAt === "string"
    && typeof candidate.attentionCount === "number"
    && typeof candidate.criticalCount === "number"
    && typeof candidate.fingerprint === "string"
    && Array.isArray(candidate.memberNames)
    && Array.isArray(candidate.alerts)
    && candidate.alerts.every(isMemberAlert);
}

function isMemberAlert(value: unknown): value is MemberActivityAlert {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MemberActivityAlert>;
  return typeof candidate.tornUserId === "number"
    && typeof candidate.memberName === "string"
    && (candidate.severity === "attention" || candidate.severity === "critical")
    && (candidate.trigger === "inactivity" || candidate.trigger === "watch" || candidate.trigger === "holiday-expired")
    && typeof candidate.daysInactive === "number"
    && typeof candidate.riskScore === "number"
    && typeof candidate.reason === "string";
}
