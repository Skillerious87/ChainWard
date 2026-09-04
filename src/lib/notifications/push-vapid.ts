import "server-only";

import { createECDH, createHash } from "node:crypto";
import webPush, { type PushSubscription } from "web-push";
import { deploymentOrigin } from "@/lib/metadata/public-origin";
import { credentialEncryptionSecret } from "@/lib/security/credential-secret";
import type { PushMessagePayload } from "./push-types";

const P256_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

export interface VapidConfiguration {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let cachedConfiguration: VapidConfiguration | null = null;

/**
 * VAPID keys must remain stable across deployments or existing subscriptions
 * stop working. Deployments may supply a dedicated pair; otherwise Chainward
 * deterministically derives an independent P-256 scalar from its required
 * 256-bit credential secret using a domain-separated hash.
 */
export function getVapidConfiguration(): VapidConfiguration {
  if (cachedConfiguration) return cachedConfiguration;
  const configuredPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const configuredPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  if (Boolean(configuredPublic) !== Boolean(configuredPrivate)) {
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together.");
  }
  const keys = configuredPublic && configuredPrivate
    ? { publicKey: configuredPublic, privateKey: configuredPrivate }
    : deriveVapidKeys(credentialEncryptionSecret());
  const subject = validVapidSubject(process.env.VAPID_SUBJECT?.trim())
    ?? deploymentOrigin()?.origin
    ?? "mailto:notifications@chainward.app";
  cachedConfiguration = { ...keys, subject };
  return cachedConfiguration;
}

export function vapidPublicKey(): string {
  return getVapidConfiguration().publicKey;
}

export async function sendWebPush(subscription: PushSubscription, payload: PushMessagePayload): Promise<void> {
  const vapid = getVapidConfiguration();
  webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  await webPush.sendNotification(subscription, JSON.stringify(payload), {
    TTL: payload.critical ? 90 : 300,
    urgency: payload.critical ? "high" : "normal",
  });
}

function deriveVapidKeys(encodedSecret: string): { publicKey: string; privateKey: string } {
  const seed = createHash("sha256")
    .update("chainward:web-push:vapid:v1\0")
    .update(Buffer.from(encodedSecret, "base64"))
    .digest();
  const scalar = (BigInt(`0x${seed.toString("hex")}`) % (P256_ORDER - 1n)) + 1n;
  const privateKey = Buffer.from(scalar.toString(16).padStart(64, "0"), "hex");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(privateKey);
  return {
    publicKey: ecdh.getPublicKey(undefined, "uncompressed").toString("base64url"),
    privateKey: privateKey.toString("base64url"),
  };
}

function validVapidSubject(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("mailto:") && value.length <= 320) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value.replace(/\/$/, "") ? url.origin : null;
  } catch {
    return null;
  }
}
