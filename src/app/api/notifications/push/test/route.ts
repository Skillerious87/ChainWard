import { z } from "zod";
import { AuthorizationError } from "@/lib/auth/authorization";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import {
  findPushSubscriptionForUser,
  recordPushFailure,
  recordPushSuccess,
} from "@/lib/notifications/push-store";
import { sendWebPush } from "@/lib/notifications/push-vapid";
import { readLimitedJson } from "@/lib/security/request-body";
import { consumePartitionRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const requestSchema = z.object({ endpoint: z.url({ protocol: /^https:$/ }).max(4_096) }).strict();

export async function POST(request: Request): Promise<Response> {
  const requestLimit = consumeRateLimit("push-test:address", request, { limit: 10, windowMs: 60_000 });
  if (!requestLimit.allowed) return rateLimited(requestLimit.retryAfterSeconds);
  try {
    const parsed = requestSchema.safeParse(await readLimitedJson(request, 8_192));
    if (!parsed.success) return Response.json({ error: "The device subscription was invalid." }, { status: 400, headers: noStoreHeaders() });
    const identity = await requireFactionPermission("faction:view");
    const actorLimit = consumePartitionRateLimit("push-test:actor", identity.actor.tornUserId, { limit: 5, windowMs: 60_000 });
    if (!actorLimit.allowed) return rateLimited(actorLimit.retryAfterSeconds);
    const target = await findPushSubscriptionForUser(identity, parsed.data.endpoint);
    if (!target) return Response.json({ error: "Enable notifications on this device before sending a test." }, { status: 404, headers: noStoreHeaders() });
    try {
      await sendWebPush(target.subscription, {
        title: "Chainward alerts are ready",
        body: "This device can receive chain and member alerts even when Chainward is closed.",
        tag: "chainward-device-test",
        url: "/settings",
      });
      await recordPushSuccess(target.id);
    } catch (error) {
      await recordPushFailure(target.id, isPermanentPushFailure(error));
      throw error;
    }
    return Response.json({ ok: true }, { headers: noStoreHeaders() });
  } catch (error) {
    const authorizationFailure = error instanceof AuthorizationError;
    return Response.json(
      { error: error instanceof Error ? error.message : "The test notification could not be sent." },
      { status: authorizationFailure ? 403 : 500, headers: noStoreHeaders() },
    );
  }
}

function isPermanentPushFailure(error: unknown): boolean {
  const statusCode = error && typeof error === "object" && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : 0;
  return statusCode === 404 || statusCode === 410;
}

function rateLimited(retryAfterSeconds: number): Response {
  return Response.json({ error: "Wait before sending another test." }, { status: 429, headers: { ...noStoreHeaders(), "retry-after": String(retryAfterSeconds) } });
}

function noStoreHeaders(): Record<string, string> {
  return { "cache-control": "no-store, max-age=0" };
}
