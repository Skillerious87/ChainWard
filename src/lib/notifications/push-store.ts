import "server-only";

import { createHmac } from "node:crypto";
import type { PushSubscription } from "web-push";
import { db } from "@/lib/db";
import { decryptCredential, encryptCredential } from "@/lib/security/credential-encryption";
import { credentialEncryptionSecret } from "@/lib/security/credential-secret";
import {
  normalizePushPreferences,
  type PushNotificationPreferences,
  type StoredPushSubscription,
} from "./push-types";

interface PushIdentity {
  actor: { tornUserId: number; name: string; isPlatformAdmin: boolean };
  faction: { id: number; name: string; tag: string };
}

export interface SavePushSubscriptionInput {
  subscription: StoredPushSubscription;
  preferences: PushNotificationPreferences;
  platform: string;
  timezone: string;
}

export function pushPersistenceConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function pushSubscriptionStatus(identity: PushIdentity): Promise<{ subscribedDevices: number }> {
  if (!pushPersistenceConfigured()) return { subscribedDevices: 0 };
  const user = await db.user.findUnique({ where: { tornUserId: identity.actor.tornUserId }, select: { id: true } });
  const faction = await db.faction.findUnique({ where: { tornFactionId: identity.faction.id }, select: { id: true } });
  if (!user || !faction) return { subscribedDevices: 0 };
  return {
    subscribedDevices: await db.webPushSubscription.count({
      where: { userId: user.id, factionId: faction.id, enabled: true },
    }),
  };
}

export async function savePushSubscription(identity: PushIdentity, input: SavePushSubscriptionInput): Promise<void> {
  requirePushPersistence();
  const secret = credentialEncryptionSecret();
  const endpointHash = hashEndpoint(input.subscription.endpoint, secret);
  const encrypted = encryptCredential(JSON.stringify(input.subscription), secret);
  await db.$transaction(async (transaction) => {
    const [user, faction] = await Promise.all([
      transaction.user.upsert({
        where: { tornUserId: identity.actor.tornUserId },
        update: { name: identity.actor.name, isPlatformAdmin: identity.actor.isPlatformAdmin, lastAuthenticatedAt: new Date() },
        create: { tornUserId: identity.actor.tornUserId, name: identity.actor.name, isPlatformAdmin: identity.actor.isPlatformAdmin, lastAuthenticatedAt: new Date() },
      }),
      transaction.faction.upsert({
        where: { tornFactionId: identity.faction.id },
        update: { name: identity.faction.name, tag: identity.faction.tag },
        create: { tornFactionId: identity.faction.id, name: identity.faction.name, tag: identity.faction.tag },
      }),
    ]);
    const existing = await transaction.webPushSubscription.findUnique({ where: { endpointHash }, select: { userId: true } });
    if (existing && existing.userId !== user.id) throw new Error("This device subscription belongs to another signed-in user.");
    await transaction.webPushSubscription.upsert({
      where: { endpointHash },
      update: {
        userId: user.id,
        factionId: faction.id,
        encryptedSubscription: Uint8Array.from(encrypted.encryptedKey),
        encryptionIv: Uint8Array.from(encrypted.encryptionIv),
        platform: input.platform,
        timezone: input.timezone,
        preferences: JSON.parse(JSON.stringify(input.preferences)) as object,
        enabled: true,
        failureCount: 0,
        lastSeenAt: new Date(),
        lastErrorAt: null,
      },
      create: {
        userId: user.id,
        factionId: faction.id,
        endpointHash,
        encryptedSubscription: Uint8Array.from(encrypted.encryptedKey),
        encryptionIv: Uint8Array.from(encrypted.encryptionIv),
        platform: input.platform,
        timezone: input.timezone,
        preferences: JSON.parse(JSON.stringify(input.preferences)) as object,
      },
    });
  });
}

export async function removePushSubscription(identity: PushIdentity, endpoint: string): Promise<void> {
  if (!pushPersistenceConfigured()) return;
  const user = await db.user.findUnique({ where: { tornUserId: identity.actor.tornUserId }, select: { id: true } });
  if (!user) return;
  await db.webPushSubscription.deleteMany({
    where: { userId: user.id, endpointHash: hashEndpoint(endpoint, credentialEncryptionSecret()) },
  });
}

export async function findPushSubscriptionForUser(identity: PushIdentity, endpoint: string): Promise<{
  id: string;
  subscription: PushSubscription;
} | null> {
  requirePushPersistence();
  const row = await db.webPushSubscription.findFirst({
    where: {
      endpointHash: hashEndpoint(endpoint, credentialEncryptionSecret()),
      user: { tornUserId: identity.actor.tornUserId },
      faction: { tornFactionId: identity.faction.id },
      enabled: true,
    },
  });
  return row ? { id: row.id, subscription: decryptPushSubscription(row.encryptedSubscription, row.encryptionIv) } : null;
}

export function decryptPushSubscription(encrypted: Uint8Array, iv: Uint8Array): PushSubscription {
  const parsed: unknown = JSON.parse(decryptCredential(encrypted, iv, credentialEncryptionSecret()));
  if (!isStoredPushSubscription(parsed)) throw new Error("The stored device subscription is malformed.");
  return parsed;
}

export function preferencesFromDatabase(value: unknown): PushNotificationPreferences {
  return normalizePushPreferences(value);
}

export async function recordPushFailure(subscriptionId: string, permanent: boolean): Promise<void> {
  await db.webPushSubscription.update({
    where: { id: subscriptionId },
    data: {
      enabled: permanent ? false : undefined,
      failureCount: { increment: 1 },
      lastErrorAt: new Date(),
    },
  });
}

export async function recordPushSuccess(subscriptionId: string): Promise<void> {
  await db.webPushSubscription.update({
    where: { id: subscriptionId },
    data: { failureCount: 0, lastErrorAt: null, lastSeenAt: new Date() },
  });
}

function hashEndpoint(endpoint: string, encodedSecret: string): string {
  return createHmac("sha256", Buffer.from(encodedSecret, "base64")).update(endpoint).digest("hex");
}

function requirePushPersistence(): void {
  if (!pushPersistenceConfigured()) throw new Error("Shared PostgreSQL storage is required for background device notifications.");
}

function isStoredPushSubscription(value: unknown): value is StoredPushSubscription {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredPushSubscription>;
  return typeof candidate.endpoint === "string"
    && (candidate.expirationTime === null || typeof candidate.expirationTime === "number")
    && Boolean(candidate.keys && typeof candidate.keys.p256dh === "string" && typeof candidate.keys.auth === "string");
}
