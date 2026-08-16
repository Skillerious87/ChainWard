import type { MemberActivityMonitorSnapshot } from "@/lib/members/member-activity-intelligence";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";

export interface OperationalNotification {
  id: string;
  category: "connection" | "chain" | "members";
  title: string;
  detail: string;
  tone: "warning" | "danger";
  priority: number;
  checkedAt: string;
  href?: "/live-chain" | "/members" | "/connect";
}

interface OperationalNotificationInput {
  telemetry: WorkspaceTelemetry;
  chainWarningSeconds: number;
  memberActivity: MemberActivityMonitorSnapshot | null;
}

/** Turns raw workspace conditions into a small, ordered action queue. */
export function buildOperationalNotifications({ telemetry, chainWarningSeconds, memberActivity }: OperationalNotificationInput): OperationalNotification[] {
  const notifications: OperationalNotification[] = [];

  if (telemetry.source === "unavailable") {
    notifications.push({ id: "connection", category: "connection", title: "Torn connection needs attention", detail: telemetry.message, tone: "warning", priority: 80, checkedAt: telemetry.checkedAt, href: "/connect" });
  }

  const chain = telemetry.chain;
  const remaining = chainRemainingSeconds(telemetry);
  if (chain?.state === "active" && remaining <= chainWarningSeconds) {
    const critical = remaining <= 60;
    notifications.push({
      id: `chain:${chain.id}:${critical ? "critical" : "warning"}`,
      category: "chain",
      title: critical ? `Chain critical: ${formatCountdown(remaining)} remaining` : `Chain warning: ${formatCountdown(remaining)} remaining`,
      detail: critical ? "A successful hit is needed urgently to protect the chain." : `The active chain is inside your ${formatCountdown(chainWarningSeconds)} warning window.`,
      tone: critical ? "danger" : "warning",
      priority: critical ? 100 : 70,
      checkedAt: telemetry.checkedAt,
      href: "/live-chain",
    });
  }

  if (memberActivity?.attentionCount) {
    const critical = memberActivity.criticalCount > 0;
    const names = memberActivity.memberNames.join(", ");
    notifications.push({
      id: `activity:${memberActivity.fingerprint}`,
      category: "members",
      title: critical ? `${memberActivity.criticalCount} critical member alert${memberActivity.criticalCount === 1 ? "" : "s"}` : `${memberActivity.attentionCount} member${memberActivity.attentionCount === 1 ? "" : "s"} need review`,
      detail: `${names}${memberActivity.attentionCount > memberActivity.memberNames.length ? ` and ${memberActivity.attentionCount - memberActivity.memberNames.length} more` : ""}. Highest-risk members are shown first.`,
      tone: critical ? "danger" : "warning",
      priority: critical ? 90 : 60,
      checkedAt: memberActivity.checkedAt,
      href: "/members",
    });
  }

  return notifications.toSorted((left, right) => right.priority - left.priority || Date.parse(right.checkedAt) - Date.parse(left.checkedAt));
}

export function chainRemainingSeconds(telemetry: WorkspaceTelemetry): number {
  return Math.max(0, (telemetry.chain?.timeoutSeconds ?? 0) - Math.ceil((telemetry.dataAgeMs ?? 0) / 1_000));
}

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
