import { z } from "zod";
import { AuthorizationError } from "@/lib/auth/authorization";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { isPermanentFcmFailure, sendFcm } from "@/lib/notifications/push-fcm";
import { findFcmRegistrationForUser, recordPushFailure, recordPushSuccess } from "@/lib/notifications/push-store";
import { readLimitedJson } from "@/lib/security/request-body";
import { consumePartitionRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const requestSchema = z.object({ token: z.string().trim().min(16).max(4_096) }).strict();

export async function POST(request: Request): Promise<Response> {
  const requestLimit = consumeRateLimit("push-fcm-test:address", request, { limit: 10, windowMs: 60_000 });
  if (!requestLimit.allowed) return rateLimited(requestLimit.retryAfterSeconds);
  try {
    const parsed = requestSchema.safeParse(await readLimitedJson(request, 8_192));
    if (!parsed.success) return Response.json({ error: "The device registration was invalid." }, { status: 400, headers: noStoreHeaders() });
    const identity = await requireFactionPermission("faction:view");
    const actorLimit = consumePartitionRateLimit("push-fcm-test:actor", identity.actor.tornUserId, { limit: 5, windowMs: 60_000 });
    if (!actorLimit.allowed) return rateLimited(actorLimit.retryAfterSeconds);
    const target = await findFcmRegistrationForUser(identity, parsed.data.token);
    if (!target) return Response.json({ error: "Enable notifications on this device before sending a test." }, { status: 404, headers: noStoreHeaders() });
    try {
      await sendFcm(target.token, {
        title: "Chainward alerts are ready",
        body: "This device can receive chain and member alerts even when Chainward is closed.",
        tag: "chainward-device-test",
        url: "/settings",
      });
      await recordPushSuccess(target.id);
    } catch (error) {
      await recordPushFailure(target.id, isPermanentFcmFailure(error));
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

function rateLimited(retryAfterSeconds: number): Response {
  return Response.json({ error: "Wait before sending another test." }, { status: 429, headers: { ...noStoreHeaders(), "retry-after": String(retryAfterSeconds) } });
}

function noStoreHeaders(): Record<string, string> {
  return { "cache-control": "no-store, max-age=0" };
}
