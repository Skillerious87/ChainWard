import "server-only";

import { cookies } from "next/headers";
import { encryptCredential } from "@/lib/security/credential-encryption";
import { credentialEncryptionSecret } from "@/lib/security/credential-secret";
import { CONNECTION_COOKIE, readConnectionSession } from "./connection-session";
import { readRememberedConnection, REMEMBERED_CONNECTION_COOKIE } from "./remembered-connection";

export interface CurrentConnectionScope {
  apiKey: string;
  tornFactionId: number;
  tornUserId: number;
  keyFingerprint: string;
}

/**
 * Resolves the caller's own session cookie into the WebAuthn scope it's
 * allowed to register a passkey against. Registration always derives scope
 * this way - never from anything the client's request body supplies - so a
 * caller can only ever enroll a passkey for the connection they already hold.
 */
export async function currentConnectionScope(): Promise<CurrentConnectionScope | null> {
  const cookieStore = await cookies();
  const rememberedToken = cookieStore.get(REMEMBERED_CONNECTION_COOKIE)?.value;
  const remembered = await readRememberedConnection(rememberedToken);
  const session = remembered ?? readConnectionSession(cookieStore.get(CONNECTION_COOKIE)?.value);
  if (!session) return null;
  return {
    apiKey: session.apiKey,
    tornFactionId: session.factionId,
    tornUserId: session.tornUserId,
    keyFingerprint: encryptCredential(session.apiKey, credentialEncryptionSecret()).fingerprint,
  };
}
