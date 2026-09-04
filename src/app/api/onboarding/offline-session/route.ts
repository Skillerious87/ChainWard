import { NextResponse } from "next/server";
import { z } from "zod";
import { registerFactionAccessRequest } from "@/lib/auth/faction-access-store";
import { mutationDeniedResponse, isTrustedMutationRequest } from "@/lib/security/request-origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { readLimitedJson } from "@/lib/security/request-body";
import { CONNECTION_COOKIE, CONNECTION_MAX_AGE_SECONDS, createConnectionSession } from "@/lib/torn/connection-session";
import { offlineConnection, offlineTestModeEnabled } from "@/lib/torn/offline-fixture";
import { REMEMBERED_CONNECTION_COOKIE } from "@/lib/torn/remembered-connection";

const requestSchema = z.object({ identity: z.enum(["member", "guest", "departed", "owner"]) }).strict();

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return mutationDeniedResponse();
  if (!offlineTestModeEnabled()) return NextResponse.json({ error: "Offline test mode is not enabled." }, { status: 404 });
  const rateLimit = consumeRateLimit("offline-session", request, { limit: 30, windowMs: 60_000 });
  if (!rateLimit.allowed) return NextResponse.json({ error: "Too many offline test sessions were opened." }, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(rateLimit.retryAfterSeconds) } });
  const parsed = requestSchema.safeParse(await readLimitedJson(request, 256).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid offline test identity." }, { status: 400 });

  const connection = offlineConnection(parsed.data.identity);
  await registerFactionAccessRequest(connection);
  const response = NextResponse.json({
    ...connection,
    apiKey: undefined,
    connected: true,
    offline: true,
    nextPath: parsed.data.identity === "owner" ? "/admin" : "/unlock",
    session: { remembered: false, expiresAt: new Date(Date.now() + CONNECTION_MAX_AGE_SECONDS * 1_000).toISOString() },
  }, { headers: { "cache-control": "no-store" } });
  response.cookies.set(CONNECTION_COOKIE, createConnectionSession(connection.apiKey, connection.player.id, connection.faction.id, {
    tornUserName: connection.player.name,
    tornUserImageUrl: connection.player.imageUrl,
    factionName: connection.faction.name,
    factionTag: connection.faction.tag,
  }), cookieOptions(CONNECTION_MAX_AGE_SECONDS));
  response.cookies.set(REMEMBERED_CONNECTION_COOKIE, "", cookieOptions(0));
  return response;
}

function cookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: "strict" as const, secure: false, path: "/", maxAge, priority: "high" as const };
}
