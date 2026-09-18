import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import type { PushMessagePayload, PushNotificationCategory } from "./push-types";

let cachedApp: App | null = null;

/** Mirrors the three channels MainActivity.createNotificationChannels() creates up front - keep in sync with android/app/src/main/java/com/chainward/app/MainActivity.java. */
const ANDROID_CHANNEL_BY_CATEGORY: Record<PushNotificationCategory, string> = {
  chain: "chainward_chain",
  members: "chainward_members",
};

/**
 * Lazily initialises the Firebase Admin app from a service account key
 * supplied whole, as JSON, in one env var - simpler to configure than
 * splitting it into three (project id / client email / private key), and
 * that's how Firebase hands the key to you in the first place.
 */
function firebaseApp(): App {
  if (cachedApp) return cachedApp;
  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return existing;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  const parsed: unknown = JSON.parse(raw);
  if (!isServiceAccount(parsed)) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not a valid Firebase service account key.");
  cachedApp = initializeApp({
    credential: cert({
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    }),
  });
  return cachedApp;
}

export function fcmConfigured(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
}

/**
 * A message with a `notification` block is what lets FCM display it via the
 * system tray even with the app fully closed - the entire reason this
 * transport exists alongside Web Push, which the Android WebView can't
 * reliably be woken for once the app is killed.
 */
export async function sendFcm(token: string, payload: PushMessagePayload): Promise<void> {
  const messaging = getMessaging(firebaseApp());
  await messaging.send({
    token,
    notification: { title: payload.title, body: payload.body },
    data: { url: payload.url, tag: payload.tag, critical: String(Boolean(payload.critical)) },
    android: {
      priority: payload.critical ? "high" : "normal",
      collapseKey: payload.tag,
      notification: payload.category ? { channelId: ANDROID_CHANNEL_BY_CATEGORY[payload.category] } : undefined,
    },
  });
}

/** Mirrors web-push's 404/410 "gone" handling, for FCM's own error codes. */
export function isPermanentFcmFailure(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
  return code === "messaging/registration-token-not-registered"
    || code === "messaging/invalid-registration-token"
    || code === "messaging/invalid-argument";
}

function isServiceAccount(value: unknown): value is { project_id: string; client_email: string; private_key: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<{ project_id: unknown; client_email: unknown; private_key: unknown }>;
  return typeof candidate.project_id === "string" && typeof candidate.client_email === "string" && typeof candidate.private_key === "string";
}
