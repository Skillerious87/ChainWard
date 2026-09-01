import { NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { consumeGlobalRateLimit, consumePartitionRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";
import { getFreshWorkspaceTelemetry, getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const requestLimit = consumeRateLimit(
    fresh ? "live-chain:fresh-address" : "live-chain:cached-address",
    request,
    fresh ? { limit: 24, windowMs: 60_000 } : { limit: 120, windowMs: 60_000 },
  );
  if (!requestLimit.allowed) return rateLimitedTelemetryResponse(requestLimit.retryAfterSeconds);
  const actor = await getCurrentActor();
  if (!actor.tornUserId) return NextResponse.json({ error: "A verified connection is required." }, { status: 401, headers: { "cache-control": "no-store" } });
  let authorization: Awaited<ReturnType<typeof requireFactionPermission>>;
  try { authorization = await requireFactionPermission("faction:view"); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "This feature is locked." }, { status: 403, headers: { "cache-control": "no-store" } }); }
  if (fresh) {
    // An active chain uses twelve fresh checks per minute. Eighteen leaves room
    // for a manual sync while constraining extra tabs and scripted refreshes.
    const actorLimit = consumePartitionRateLimit("live-chain:fresh-actor", actor.tornUserId, { limit: 18, windowMs: 60_000 });
    const processLimit = consumeGlobalRateLimit("live-chain:fresh-process", { limit: 120, windowMs: 60_000 });
    if (!actorLimit.allowed || !processLimit.allowed) {
      return rateLimitedTelemetryResponse(Math.max(actorLimit.retryAfterSeconds, processLimit.retryAfterSeconds));
    }
  }
  const telemetry = fresh
    ? await getFreshWorkspaceTelemetry()
    : await getWorkspaceTelemetry();
  if (telemetry.source !== "live" || !telemetry.faction) return NextResponse.json({ error: "Verified Torn telemetry is unavailable." }, { status: 503, headers: { "cache-control": "no-store" } });
  if (telemetry.faction.id !== authorization.faction.id) return NextResponse.json({ error: "The fresh Torn response no longer matches the authorised faction." }, { status: 409, headers: { "cache-control": "no-store" } });
  return NextResponse.json(telemetry, {
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  });
}

function rateLimitedTelemetryResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Chain telemetry is being requested too frequently. Wait before trying again." },
    { status: 429, headers: { "cache-control": "no-store", "retry-after": String(retryAfterSeconds) } },
  );
}
