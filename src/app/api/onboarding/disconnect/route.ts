import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CONNECTION_COOKIE } from "@/lib/torn/connection-session";
import { REMEMBERED_CONNECTION_COOKIE, revokeRememberedConnection } from "@/lib/torn/remembered-connection";

export async function POST() {
  const cookieStore = await cookies();
  await revokeRememberedConnection(cookieStore.get(REMEMBERED_CONNECTION_COOKIE)?.value);
  const response = NextResponse.json({ disconnected: true }, { headers: { "cache-control": "no-store" } });
  const expired = { httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0, priority: "high" as const };
  response.cookies.set(CONNECTION_COOKIE, "", expired);
  response.cookies.set(REMEMBERED_CONNECTION_COOKIE, "", expired);
  return response;
}
