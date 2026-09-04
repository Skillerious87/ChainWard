export type PushNotificationLevel = "attention" | "critical";
export type PushNotificationIntervalMinutes = 5 | 15 | 30 | 60;
export type PushNotificationReminderHours = 0 | 4 | 12 | 24;

export interface PushNotificationPreferences {
  enabled: boolean;
  includeChainAlerts: boolean;
  chainWarningSeconds: 60 | 120 | 180 | 300;
  minimumLevel: PushNotificationLevel;
  intervalMinutes: PushNotificationIntervalMinutes;
  reminderHours: PushNotificationReminderHours;
  includeWatchList: boolean;
  includeExpiredHolidays: boolean;
  keepCriticalVisible: boolean;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}

export interface StoredPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export interface PushMessagePayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  requireInteraction?: boolean;
  critical?: boolean;
}

export const defaultPushNotificationPreferences: PushNotificationPreferences = {
  enabled: false,
  includeChainAlerts: true,
  chainWarningSeconds: 180,
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

export function normalizePushPreferences(value: unknown): PushNotificationPreferences {
  const candidate = value && typeof value === "object" ? value as Partial<PushNotificationPreferences> : {};
  return {
    enabled: candidate.enabled === true,
    includeChainAlerts: candidate.includeChainAlerts !== false,
    chainWarningSeconds: isChainWarning(candidate.chainWarningSeconds) ? candidate.chainWarningSeconds : defaultPushNotificationPreferences.chainWarningSeconds,
    minimumLevel: candidate.minimumLevel === "critical" ? "critical" : "attention",
    intervalMinutes: isInterval(candidate.intervalMinutes) ? candidate.intervalMinutes : defaultPushNotificationPreferences.intervalMinutes,
    reminderHours: isReminder(candidate.reminderHours) ? candidate.reminderHours : defaultPushNotificationPreferences.reminderHours,
    includeWatchList: candidate.includeWatchList !== false,
    includeExpiredHolidays: candidate.includeExpiredHolidays !== false,
    keepCriticalVisible: candidate.keepCriticalVisible !== false,
    quietHoursEnabled: candidate.quietHoursEnabled !== false,
    quietStart: isTime(candidate.quietStart) ? candidate.quietStart : defaultPushNotificationPreferences.quietStart,
    quietEnd: isTime(candidate.quietEnd) ? candidate.quietEnd : defaultPushNotificationPreferences.quietEnd,
  };
}

export function isPushQuietTime(preferences: PushNotificationPreferences, timezone: string, date = new Date()): boolean {
  if (!preferences.quietHoursEnabled) return false;
  const current = localMinutes(date, timezone);
  const start = timeMinutes(preferences.quietStart);
  const end = timeMinutes(preferences.quietEnd);
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function localMinutes(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    return hour * 60 + minute;
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

function timeMinutes(value: string): number {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isInterval(value: unknown): value is PushNotificationIntervalMinutes {
  return value === 5 || value === 15 || value === 30 || value === 60;
}

function isReminder(value: unknown): value is PushNotificationReminderHours {
  return value === 0 || value === 4 || value === 12 || value === 24;
}

function isChainWarning(value: unknown): value is PushNotificationPreferences["chainWarningSeconds"] {
  return value === 60 || value === 120 || value === 180 || value === 300;
}
