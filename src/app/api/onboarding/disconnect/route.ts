import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isTrustedMutationRequest, mutationDeniedResponse } from "@/lib/security/request-origin";
import { consumeGlobalRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";
import { CONNECTION_COOKIE } from "@/lib/torn/connection-session";
import { REMEMBERED_CONNECTION_COOKIE, revokeRememberedConnection } from "@/lib/torn/remembered-connection";

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return mutationDeniedResponse();
  const requestLimit = consumeRateLimit("disconnect:address", request, { limit: 30, windowMs: 60_000 });
  const processLimit = consumeGlobalRateLimit("disconnect:process", { limit: 300, windowMs: 60_000 });
  if (!requestLimit.allowed || !processLimit.allowed) {
    return NextResponse.json(
      { error: "Too many disconnect requests. Wait before trying again." },
      { status: 429, headers: { "cache-control": "no-store", "retry-after": String(Math.max(requestLimit.retryAfterSeconds, processLimit.retryAfterSeconds)) } },
    );
  }
  const cookieStore = await cookies();
  await revokeRememberedConnection(cookieStore.get(REMEMBERED_CONNECTION_COOKIE)?.value);
  const response = NextResponse.json({ disconnected: true }, { headers: { "cache-control": "no-store" } });
  const expired = { httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0, priority: "high" as const };
  response.cookies.set(CONNECTION_COOKIE, "", expired);
  response.cookies.set(REMEMBERED_CONNECTION_COOKIE, "", expired);
  return response;
}
