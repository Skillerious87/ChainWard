import "server-only";

import { NextResponse } from "next/server";
import { registerFactionAccessRequest } from "@/lib/auth/faction-access-store";
import { encryptCredential } from "@/lib/security/credential-encryption";
import { credentialEncryptionSecret } from "@/lib/security/credential-secret";
import { recordAuthEvent } from "./auth-audit";
import type { ValidatedTornConnection } from "./connection-service";
import { CONNECTION_COOKIE, CONNECTION_MAX_AGE_SECONDS, createConnectionSession } from "./connection-session";
import { createRememberedConnection, REMEMBERED_CONNECTION_COOKIE, REMEMBERED_CONNECTION_COOKIE_MAX_AGE_SECONDS } from "./remembered-connection";

export interface EstablishedConnectionOptions {
  remember: boolean;
  /** Which entry point established this connection, for the sign-in audit trail. */
  method: "key" | "passkey";
  /** Extra fields merged into the JSON body, e.g. `hasWebauthnCredential`. */
  extra?: Record<string, unknown>;
}

/**
 * Turns a Torn connection that has already been validated (fresh key paste or
 * a re-validated WebAuthn unlock) into a session cookie and response body.
 * Both entry points funnel through here so a session is indistinguishable
 * downstream regardless of how it was established.
 */
export async function respondWithEstablishedConnection(
  apiKey: string,
  connection: ValidatedTornConnection,
  options: EstablishedConnectionOptions,
): Promise<NextResponse> {
  await registerFactionAccessRequest(connection);

  let session:
    | { kind: "remembered"; value: Awaited<ReturnType<typeof createRememberedConnection>> }
    | { kind: "temporary"; value: string; keyFingerprint: string };
  if (options.remember) {
    session = { kind: "remembered", value: await createRememberedConnection(apiKey, connection) };
  } else {
    session = {
      kind: "temporary",
      value: createConnectionSession(apiKey, connection.player.id, connection.faction.id, {
        tornUserName: connection.player.name,
        tornUserImageUrl: connection.player.imageUrl,
        factionName: connection.faction.name,
        factionTag: connection.faction.tag,
      }),
      keyFingerprint: encryptCredential(apiKey, credentialEncryptionSecret()).fingerprint,
    };
  }

  const response = NextResponse.json({
    ...connection,
    connected: true,
    session: {
      remembered: session.kind === "remembered",
      expiresAt: new Date(session.kind === "remembered" ? session.value.expiresAt : Date.now() + CONNECTION_MAX_AGE_SECONDS * 1_000).toISOString(),
    },
    ...(options.extra ?? {}),
  }, {
    headers: { "cache-control": "no-store" },
  });
  if (session.kind === "remembered") {
    response.cookies.set(REMEMBERED_CONNECTION_COOKIE, session.value.token, connectionCookieOptions(REMEMBERED_CONNECTION_COOKIE_MAX_AGE_SECONDS));
    response.cookies.set(CONNECTION_COOKIE, "", connectionCookieOptions(0));
  } else {
    response.cookies.set(CONNECTION_COOKIE, session.value, connectionCookieOptions(CONNECTION_MAX_AGE_SECONDS));
    response.cookies.set(REMEMBERED_CONNECTION_COOKIE, "", connectionCookieOptions(0));
  }

  // Awaited, not fire-and-forget: a serverless runtime can freeze this
  // function as soon as the response is returned, which would silently drop
  // an unawaited write.
  const keyFingerprint = session.kind === "remembered" ? session.value.keyFingerprint : session.keyFingerprint;
  await recordAuthEvent(options.method === "passkey" ? "auth.passkey_login" : "auth.key_login", {
    tornFactionId: connection.faction.id,
    tornUserId: connection.player.id,
    keyFingerprint,
    metadata: { remembered: session.kind === "remembered" },
  });

  return response;
}

function connectionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
    priority: "high" as const,
  };
}
