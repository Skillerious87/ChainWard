import { timingSafeEqual } from "node:crypto";
import { claimPushDispatchWindow, dispatchPushNotifications } from "@/lib/notifications/push-dispatcher";
import { pushPersistenceConfigured } from "@/lib/notifications/push-store";
import { consumeGlobalRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const requestLimit = consumeGlobalRateLimit("push-dispatch", { limit: 15, windowMs: 60_000 });
  if (!requestLimit.allowed) {
    return Response.json({ error: "Background notification dispatch is being requested too frequently." }, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(requestLimit.retryAfterSeconds) } });
  }
  if (!authorisedCronRequest(request)) {
    return Response.json({ error: "Background notification dispatch is not authorised." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  try {
    if (!pushPersistenceConfigured()) return Response.json({ skipped: "PostgreSQL is not configured." }, { status: 503, headers: { "cache-control": "no-store" } });
    if (!await claimPushDispatchWindow()) return Response.json({ skipped: "This minute is already being processed." }, { status: 202, headers: { "cache-control": "no-store" } });
    const result = await dispatchPushNotifications();
    return Response.json(result, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Background notification dispatch failed." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

function authorisedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  // Vercel cron has no configurable header other than CRON_SECRET. When that
  // optional secret is absent, the durable one-minute database reservation
  // still ensures a public retry cannot multiply Torn calls or push delivery.
  if (!secret) return true;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}
