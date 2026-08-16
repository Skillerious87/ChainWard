import { describe, expect, it } from "vitest";
import { eligibleMemberAlerts } from "@/components/members/use-member-activity-monitor";
import {
  defaultMemberNotificationPreferences,
  isNotificationQuietTime,
} from "./member-notification-preferences";
import type { MemberActivityAlert } from "./members/member-activity-intelligence";

const inactivity: MemberActivityAlert = { tornUserId: 1, memberName: "Alpha", severity: "critical", trigger: "inactivity", daysInactive: 10, riskScore: 90, reason: "Critical" };
const watch: MemberActivityAlert = { tornUserId: 2, memberName: "Bravo", severity: "attention", trigger: "watch", daysInactive: 0.5, riskScore: 100, reason: "Watch" };
const expired: MemberActivityAlert = { tornUserId: 3, memberName: "Charlie", severity: "attention", trigger: "holiday-expired", daysInactive: 4, riskScore: 95, reason: "Expired" };

describe("member notification preferences", () => {
  it("filters alert classes without hiding critical inactivity", () => {
    expect(eligibleMemberAlerts([inactivity, watch, expired], { ...defaultMemberNotificationPreferences, includeWatchList: false, includeExpiredHolidays: false })).toEqual([inactivity]);
    expect(eligibleMemberAlerts([inactivity, watch, expired], { ...defaultMemberNotificationPreferences, minimumLevel: "critical" })).toEqual([inactivity]);
  });

  it("handles overnight and daytime quiet-hour windows", () => {
    const overnight = { ...defaultMemberNotificationPreferences, quietStart: "23:00", quietEnd: "08:00" };
    expect(isNotificationQuietTime(overnight, new Date(2026, 0, 1, 23, 30))).toBe(true);
    expect(isNotificationQuietTime(overnight, new Date(2026, 0, 2, 8, 0))).toBe(false);
    const daytime = { ...overnight, quietStart: "12:00", quietEnd: "14:00" };
    expect(isNotificationQuietTime(daytime, new Date(2026, 0, 2, 13, 0))).toBe(true);
    expect(isNotificationQuietTime(daytime, new Date(2026, 0, 2, 15, 0))).toBe(false);
  });
});
