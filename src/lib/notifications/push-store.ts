import "server-only";

import { createHmac } from "node:crypto";
import type { PushSubscription } from "web-push";
import { db } from "@/lib/db";
import { decryptCredential, encryptCredential } from "@/lib/security/credential-encryption";
import { credentialEncryptionSecret } from "@/lib/security/credential-secret";
import {
  normalizePushPreferences,
  type PushNotificationPreferences,
  type StoredFcmRegistration,
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
  const secret = credentialEncryptionSecret();
  const endpointHash = hashEndpoint(input.subscription.endpoint, secret);
  const encrypted = encryptCredential(JSON.stringify(input.subscription), secret);
  await upsertDeviceRegistration({
    identity,
    transport: "WEB_PUSH",
    endpointHash,
    encrypted,
    preferences: input.preferences,
    platform: input.platform,
    timezone: input.timezone,
  });
}

export interface SaveFcmRegistrationInput {
  token: string;
  preferences: PushNotificationPreferences;
  platform: string;
  timezone: string;
}

/** The Capacitor Android app's counterpart to `savePushSubscription` - same pipeline, an FCM token instead of a browser PushSubscription. */
export async function saveFcmRegistration(identity: PushIdentity, input: SaveFcmRegistrationInput): Promise<void> {
  const secret = credentialEncryptionSecret();
  const endpointHash = hashEndpoint(input.token, secret);
  const stored: StoredFcmRegistration = { token: input.token };
  const encrypted = encryptCredential(JSON.stringify(stored), secret);
  await upsertDeviceRegistration({
    identity,
    transport: "FCM",
    endpointHash,
    encrypted,
    preferences: input.preferences,
    platform: input.platform,
    timezone: input.timezone,
  });
}

interface UpsertRegistrationInput {
  identity: PushIdentity;
  transport: "WEB_PUSH" | "FCM";
  endpointHash: string;
  encrypted: { encryptedKey: Buffer; encryptionIv: Buffer };
  preferences: PushNotificationPreferences;
  platform: string;
  timezone: string;
}

async function upsertDeviceRegistration(input: UpsertRegistrationInput): Promise<void> {
  requirePushPersistence();
  const { identity, transport, endpointHash } = input;
  const encryptedSubscription = Uint8Array.from(input.encrypted.encryptedKey);
  const encryptionIv = Uint8Array.from(input.encrypted.encryptionIv);
  const preferences = JSON.parse(JSON.stringify(input.preferences)) as object;
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
        encryptedSubscription,
        encryptionIv,
        transport,
        platform: input.platform,
        timezone: input.timezone,
        preferences,
        enabled: true,
        failureCount: 0,
        lastSeenAt: new Date(),
        lastErrorAt: null,
      },
      create: {
        userId: user.id,
        factionId: faction.id,
        endpointHash,
        encryptedSubscription,
        encryptionIv,
        transport,
        platform: input.platform,
        timezone: input.timezone,
        preferences,
      },
    });
  });
}

export async function removePushSubscription(identity: PushIdentity, endpoint: string): Promise<void> {
  await removeRegistrationByKey(identity, endpoint);
}

export async function removeFcmRegistration(identity: PushIdentity, token: string): Promise<void> {
  await removeRegistrationByKey(identity, token);
}

async function removeRegistrationByKey(identity: PushIdentity, endpointOrToken: string): Promise<void> {
  if (!pushPersistenceConfigured()) return;
  const user = await db.user.findUnique({ where: { tornUserId: identity.actor.tornUserId }, select: { id: true } });
  if (!user) return;
  await db.webPushSubscription.deleteMany({
    where: { userId: user.id, endpointHash: hashEndpoint(endpointOrToken, credentialEncryptionSecret()) },
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

export async function findFcmRegistrationForUser(identity: PushIdentity, token: string): Promise<{
  id: string;
  token: string;
} | null> {
  requirePushPersistence();
  const row = await db.webPushSubscription.findFirst({
    where: {
      endpointHash: hashEndpoint(token, credentialEncryptionSecret()),
      user: { tornUserId: identity.actor.tornUserId },
      faction: { tornFactionId: identity.faction.id },
      enabled: true,
    },
  });
  return row ? { id: row.id, token: decryptFcmRegistration(row.encryptedSubscription, row.encryptionIv).token } : null;
}

export function decryptPushSubscription(encrypted: Uint8Array, iv: Uint8Array): PushSubscription {
  const parsed: unknown = JSON.parse(decryptCredential(encrypted, iv, credentialEncryptionSecret()));
  if (!isStoredPushSubscription(parsed)) throw new Error("The stored device subscription is malformed.");
  return parsed;
}

export function decryptFcmRegistration(encrypted: Uint8Array, iv: Uint8Array): StoredFcmRegistration {
  const parsed: unknown = JSON.parse(decryptCredential(encrypted, iv, credentialEncryptionSecret()));
  if (!isStoredFcmRegistration(parsed)) throw new Error("The stored device registration is malformed.");
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

function isStoredFcmRegistration(value: unknown): value is StoredFcmRegistration {
  return Boolean(value && typeof value === "object" && typeof (value as Partial<StoredFcmRegistration>).token === "string");
}
