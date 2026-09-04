import { describe, expect, it } from "vitest";
import { defaultPushNotificationPreferences, isPushQuietTime, normalizePushPreferences } from "./push-types";

describe("push notification preferences", () => {
  it("keeps chain alerts on for subscriptions created before the field existed", () => {
    expect(normalizePushPreferences({ enabled: true }).includeChainAlerts).toBe(true);
  });

  it("rejects unsupported intervals and warning thresholds", () => {
    const preferences = normalizePushPreferences({ intervalMinutes: 1, chainWarningSeconds: 17 });
    expect(preferences.intervalMinutes).toBe(defaultPushNotificationPreferences.intervalMinutes);
    expect(preferences.chainWarningSeconds).toBe(defaultPushNotificationPreferences.chainWarningSeconds);
  });

  it("evaluates overnight quiet hours in the device timezone", () => {
    const preferences = normalizePushPreferences({ quietHoursEnabled: true, quietStart: "23:00", quietEnd: "08:00" });
    expect(isPushQuietTime(preferences, "Europe/London", new Date("2026-01-15T23:30:00Z"))).toBe(true);
    expect(isPushQuietTime(preferences, "Europe/London", new Date("2026-01-15T12:00:00Z"))).toBe(false);
  });
});
