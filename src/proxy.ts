import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * A returning visitor whose device already has a working Chainward passkey
 * (set client-side by `markDeviceHasPasskey` in src/lib/passkey-device-flag.ts)
 * gets the sign-in screen directly instead of the marketing homepage - the
 * pitch has already landed, and /connect auto-prompts their fingerprint/PIN
 * from there. Everyone else still gets the ordinary static homepage.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.get("chainward_passkey_device")?.value === "1") {
    return NextResponse.redirect(new URL("/connect", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
