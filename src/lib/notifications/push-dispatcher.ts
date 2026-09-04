import "server-only";

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { buildMemberActivityAlert, type MemberActivityAlert } from "@/lib/members/member-activity-intelligence";
import { getMemberActivityWorkspace, synchronizeMemberInactivityPeriods } from "@/lib/members/member-activity-store";
import { decryptCredential } from "@/lib/security/credential-encryption";
import { credentialEncryptionSecret } from "@/lib/security/credential-secret";
import { createTornClient } from "@/lib/torn/server-client";
import { mapFactionMember } from "@/lib/torn/workspace-data-service";
import {
  decryptPushSubscription,
  preferencesFromDatabase,
  pushPersistenceConfigured,
  recordPushFailure,
  recordPushSuccess,
} from "./push-store";
import { isPushQuietTime, type PushMessagePayload, type PushNotificationPreferences } from "./push-types";
import { sendWebPush } from "./push-vapid";

interface PushTarget {
  id: string;
  encryptedSubscription: Uint8Array;
  encryptionIv: Uint8Array;
  timezone: string;
  preferences: unknown;
  lastMemberCheckAt: Date | null;
  user: {
    tornUserId: number;
    isPlatformAdmin: boolean;
    memberships: { factionId: string; role: string; status: string }[];
  };
}

export interface PushDispatchResult {
  factionsChecked: number;
  sent: number;
  duplicate: number;
  failed: number;
}

/**
 * Atomically reserves one UTC minute across every server instance. This is the
 * durable backstop for scheduler retries and also bounds work safely on hosts
 * that do not inject a CRON_SECRET header.
 */
export async function claimPushDispatchWindow(now = new Date()): Promise<boolean> {
  const minute = Math.floor(now.getTime() / 60_000);
  try {
    await db.applicationSetting.create({
      data: { key: `notifications.dispatch.${minute}`, value: { startedAt: now.toISOString() } },
    });
  } catch (error) {
    if (isUniqueConstraint(error)) return false;
    throw error;
  }
  await db.applicationSetting.deleteMany({
    where: { key: { startsWith: "notifications.dispatch." }, updatedAt: { lt: new Date(now.getTime() - 2 * 3_600_000) } },
  });
  return true;
}

/** Runs one durable background-monitor pass across subscribed factions. */
export async function dispatchPushNotifications(now = new Date()): Promise<PushDispatchResult> {
  const result: PushDispatchResult = { factionsChecked: 0, sent: 0, duplicate: 0, failed: 0 };
  if (!pushPersistenceConfigured()) return result;
  await db.webPushDelivery.deleteMany({ where: { sentAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
  const factions = await db.faction.findMany({
    where: { pushSubscriptions: { some: { enabled: true } } },
    include: {
      apiCredentials: { where: { status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: 1 },
      chainWatchSlots: { where: { startAt: { lte: now }, endAt: { gt: now } }, orderBy: { startAt: "desc" }, take: 1 },
      pushSubscriptions: {
        where: { enabled: true },
        include: { user: { include: { memberships: { where: { status: "ACTIVE" } } } } },
      },
    },
  });

  for (const faction of factions) {
    const credential = faction.apiCredentials[0];
    if (!credential) continue;
    result.factionsChecked += 1;
    try {
      const apiKey = decryptCredential(credential.encryptedKey, credential.encryptionIv, credentialEncryptionSecret());
      const client = createTornClient(apiKey);
      const chain = await client.getCurrentChain(faction.tornFactionId, { forceRefresh: true, bypassUpstreamCache: true });
      await dispatchChainAlerts(faction.id, faction.name, faction.pushSubscriptions, faction.chainWatchSlots[0] ?? null, chain.chain, result, now);
      await dispatchMemberAlerts(faction, credential.ownerTornUserId, client, result, now);
    } catch {
      // One inaccessible Torn credential must not block other subscribed factions.
      result.failed += 1;
    }
  }
  return result;
}

async function dispatchChainAlerts(
  factionId: string,
  factionName: string,
  subscriptions: PushTarget[],
  slot: { primaryTornUserId: number; primaryMemberName: string; backupTornUserId: number | null; backupMemberName: string | null } | null,
  chain: { id: number; current: number; max: number; timeout: number },
  result: PushDispatchResult,
  now: Date,
): Promise<void> {
  if (chain.id <= 0 || chain.current <= 0 || chain.timeout <= 0) return;
  const assignedIds = slot ? new Set([slot.primaryTornUserId, slot.backupTornUserId].filter((value): value is number => value !== null)) : null;
  const targets = subscriptions.filter((subscription) => {
    const preferences = preferencesFromDatabase(subscription.preferences);
    return preferences.enabled
      && preferences.includeChainAlerts
      && chain.timeout <= preferences.chainWarningSeconds
      && (!assignedIds || assignedIds.has(subscription.user.tornUserId));
  });
  for (const target of targets) {
    const preferences = preferencesFromDatabase(target.preferences);
    const critical = chain.timeout <= 60;
    if (!critical && isPushQuietTime(preferences, target.timezone, now)) continue;
    const band = critical ? "critical" : "warning";
    const resetMarker = chain.current >= 10 ? String(chain.current) : "warmup";
    const responsibility = slot
      ? target.user.tornUserId === slot.primaryTornUserId
        ? `You are the active ${slot.primaryMemberName ? "primary" : "chain"} watcher.`
        : `You are the active backup for ${slot.primaryMemberName}.`
      : "No watcher is scheduled, so every subscribed operator is being warned.";
    await deliverOnce(target, `chain:${chain.id}:${resetMarker}:${band}`, {
      title: critical ? `Chain critical · ${formatCountdown(chain.timeout)}` : `Chain warning · ${formatCountdown(chain.timeout)}`,
      body: `${factionName}: ${chain.current.toLocaleString()} / ${chain.max.toLocaleString()} hits. ${responsibility}`,
      tag: `chainward-chain-${factionId}-${chain.id}`,
      url: "/live-chain",
      critical,
      requireInteraction: critical && preferences.keepCriticalVisible,
    }, result);
  }
}

async function dispatchMemberAlerts(
  faction: {
    id: string;
    tornFactionId: number;
    name: string;
    tag: string | null;
    pushSubscriptions: PushTarget[];
  },
  credentialOwnerTornId: number,
  client: ReturnType<typeof createTornClient>,
  result: PushDispatchResult,
  now: Date,
): Promise<void> {
  const authorised = faction.pushSubscriptions.filter((target) => canReceiveMemberAlerts(target, faction.id, credentialOwnerTornId));
  const due = authorised.filter((target) => {
    const preferences = preferencesFromDatabase(target.preferences);
    return preferences.enabled && (!target.lastMemberCheckAt || now.getTime() - target.lastMemberCheckAt.getTime() >= preferences.intervalMinutes * 60_000);
  });
  if (!due.length) return;
  const [membersResponse, workspace] = await Promise.all([
    client.getFactionMembers(faction.tornFactionId),
    getMemberActivityWorkspace(faction.tornFactionId),
  ]);
  const members = membersResponse.members.map(mapFactionMember);
  const checkedAt = now.toISOString();
  if (workspace.databaseAvailable) {
    await synchronizeMemberInactivityPeriods({ id: faction.tornFactionId, name: faction.name, tag: faction.tag ?? "" }, members, workspace.records, checkedAt);
  }
  const snapshot = buildMemberActivityAlert(members, workspace, checkedAt);
  for (const target of due) {
    const preferences = preferencesFromDatabase(target.preferences);
    const alerts = eligibleMemberAlerts(snapshot.alerts, preferences);
    if (!alerts.length || isPushQuietTime(preferences, target.timezone, now)) continue;
    const criticalCount = alerts.filter((alert) => alert.severity === "critical").length;
    const fingerprint = createHash("sha256")
      .update(alerts.map((alert) => `${alert.tornUserId}:${alert.severity}:${alert.trigger}`).toSorted().join("|"))
      .digest("base64url")
      .slice(0, 24);
    const reminder = preferences.reminderHours > 0
      ? `:${Math.floor(now.getTime() / (preferences.reminderHours * 3_600_000))}`
      : "";
    await deliverOnce(target, `members:${fingerprint}${reminder}`, {
      title: criticalCount
        ? `${criticalCount} critical member alert${criticalCount === 1 ? "" : "s"}`
        : `${alerts.length} member${alerts.length === 1 ? "" : "s"} need review`,
      body: `${faction.name}: open the protected member queue for details.`,
      tag: `chainward-members-${faction.id}`,
      url: "/members?view=attention",
      critical: criticalCount > 0,
      requireInteraction: criticalCount > 0 && preferences.keepCriticalVisible,
    }, result);
  }
  await db.webPushSubscription.updateMany({
    where: { id: { in: due.map((target) => target.id) } },
    data: { lastMemberCheckAt: now },
  });
}

async function deliverOnce(target: PushTarget, eventKey: string, payload: PushMessagePayload, result: PushDispatchResult): Promise<void> {
  try {
    await db.webPushDelivery.create({ data: { subscriptionId: target.id, eventKey } });
  } catch (error) {
    if (isUniqueConstraint(error)) {
      result.duplicate += 1;
      return;
    }
    throw error;
  }
  try {
    await sendWebPush(decryptPushSubscription(target.encryptedSubscription, target.encryptionIv), payload);
    await recordPushSuccess(target.id);
    result.sent += 1;
  } catch (error) {
    const permanent = isPermanentPushFailure(error);
    await recordPushFailure(target.id, permanent).catch(() => undefined);
    if (!permanent) {
      await db.webPushDelivery.deleteMany({ where: { subscriptionId: target.id, eventKey } }).catch(() => undefined);
    }
    result.failed += 1;
  }
}

function eligibleMemberAlerts(alerts: MemberActivityAlert[], preferences: PushNotificationPreferences): MemberActivityAlert[] {
  return alerts.filter((alert) => {
    if (preferences.minimumLevel === "critical" && alert.severity !== "critical") return false;
    if (!preferences.includeWatchList && alert.trigger === "watch") return false;
    if (!preferences.includeExpiredHolidays && alert.trigger === "holiday-expired") return false;
    return true;
  });
}

function canReceiveMemberAlerts(target: PushTarget, factionId: string, credentialOwnerTornId: number): boolean {
  return target.user.isPlatformAdmin
    || target.user.tornUserId === credentialOwnerTornId
    || target.user.memberships.some((membership) => membership.factionId === factionId && (membership.role === "OWNER" || membership.role === "ADMINISTRATOR"));
}

function isUniqueConstraint(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002");
}

function isPermanentPushFailure(error: unknown): boolean {
  const statusCode = error && typeof error === "object" && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : 0;
  return statusCode === 404 || statusCode === 410;
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
