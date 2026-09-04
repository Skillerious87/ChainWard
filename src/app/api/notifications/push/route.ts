import { z } from "zod";
import { AuthorizationError } from "@/lib/auth/authorization";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import {
  pushPersistenceConfigured,
  pushSubscriptionStatus,
  removePushSubscription,
  savePushSubscription,
} from "@/lib/notifications/push-store";
import { normalizePushPreferences } from "@/lib/notifications/push-types";
import { vapidPublicKey } from "@/lib/notifications/push-vapid";
import { readLimitedJson } from "@/lib/security/request-body";
import { consumePartitionRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const endpointSchema = z.url({ protocol: /^https:$/ }).max(4_096);
const requestSchema = z.object({
  subscription: z.object({
    endpoint: endpointSchema,
    expirationTime: z.number().nonnegative().nullable(),
    keys: z.object({
      p256dh: z.string().min(16).max(512),
      auth: z.string().min(8).max(256),
    }).strict(),
  }).strict(),
  preferences: z.record(z.string(), z.unknown()),
  platform: z.string().trim().min(1).max(80),
  timezone: z.string().trim().min(1).max(100),
}).strict();

const deleteSchema = z.object({ endpoint: endpointSchema }).strict();

export async function GET(request: Request): Promise<Response> {
  const requestLimit = consumeRateLimit("push-status:address", request, { limit: 60, windowMs: 60_000 });
  if (!requestLimit.allowed) return rateLimited(requestLimit.retryAfterSeconds);
  try {
    const identity = await requireFactionPermission("faction:view");
    const status = await pushSubscriptionStatus(identity);
    return Response.json({
      available: pushPersistenceConfigured(),
      publicKey: pushPersistenceConfigured() ? vapidPublicKey() : null,
      ...status,
    }, { headers: noStoreHeaders() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestLimit = consumeRateLimit("push-subscribe:address", request, { limit: 20, windowMs: 60_000 });
  if (!requestLimit.allowed) return rateLimited(requestLimit.retryAfterSeconds);
  try {
    const parsed = requestSchema.safeParse(await readLimitedJson(request, 16_384));
    if (!parsed.success) return Response.json({ error: "The device subscription was invalid." }, { status: 400, headers: noStoreHeaders() });
    const identity = await requireFactionPermission("faction:view");
    const actorLimit = consumePartitionRateLimit("push-subscribe:actor", identity.actor.tornUserId, { limit: 12, windowMs: 60_000 });
    if (!actorLimit.allowed) return rateLimited(actorLimit.retryAfterSeconds);
    await savePushSubscription(identity, {
      ...parsed.data,
      preferences: normalizePushPreferences(parsed.data.preferences),
    });
    return Response.json({ ok: true }, { headers: noStoreHeaders() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const requestLimit = consumeRateLimit("push-unsubscribe:address", request, { limit: 20, windowMs: 60_000 });
  if (!requestLimit.allowed) return rateLimited(requestLimit.retryAfterSeconds);
  try {
    const parsed = deleteSchema.safeParse(await readLimitedJson(request, 8_192));
    if (!parsed.success) return Response.json({ error: "The device subscription was invalid." }, { status: 400, headers: noStoreHeaders() });
    const identity = await requireFactionPermission("faction:view");
    await removePushSubscription(identity, parsed.data.endpoint);
    return Response.json({ ok: true }, { headers: noStoreHeaders() });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  const authorizationFailure = error instanceof AuthorizationError;
  const unavailable = error instanceof Error && error.message.includes("PostgreSQL");
  return Response.json(
    { error: error instanceof Error ? error.message : "Device notifications are unavailable." },
    { status: authorizationFailure ? 403 : unavailable ? 503 : 500, headers: noStoreHeaders() },
  );
}

function rateLimited(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "Device notification settings are changing too frequently." },
    { status: 429, headers: { ...noStoreHeaders(), "retry-after": String(retryAfterSeconds) } },
  );
}

function noStoreHeaders(): Record<string, string> {
  return { "cache-control": "no-store, max-age=0" };
}
