import { NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { requireActiveFactionLicense } from "@/lib/licensing/guards";
import { getFreshWorkspaceTelemetry, getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getCurrentActor();
  if (!actor.tornUserId) return NextResponse.json({ error: "A verified connection is required." }, { status: 401, headers: { "cache-control": "no-store" } });
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const telemetry = fresh
    ? await getFreshWorkspaceTelemetry()
    : await getWorkspaceTelemetry();
  if (telemetry.source !== "live" || !telemetry.faction) return NextResponse.json({ error: "Verified Torn telemetry is unavailable." }, { status: 503, headers: { "cache-control": "no-store" } });
  try { await requireActiveFactionLicense(telemetry.faction.id); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "This feature is locked." }, { status: 403, headers: { "cache-control": "no-store" } }); }
  return NextResponse.json(telemetry, {
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  });
}
