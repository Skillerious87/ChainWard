import { NextResponse } from "next/server";
import { getFreshWorkspaceTelemetry, getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const telemetry = fresh
    ? await getFreshWorkspaceTelemetry()
    : await getWorkspaceTelemetry();
  return NextResponse.json(telemetry, {
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  });
}
