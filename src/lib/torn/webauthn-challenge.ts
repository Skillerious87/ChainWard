import "server-only";

import { decryptCredential, encryptCredential } from "@/lib/security/credential-encryption";
import { credentialEncryptionSecret } from "@/lib/security/credential-secret";

export const WEBAUTHN_CHALLENGE_COOKIE = "chainward_webauthn_challenge";
export const WEBAUTHN_CHALLENGE_MAX_AGE_SECONDS = 120;

export type WebauthnChallengePurpose = "registration" | "authentication";

export interface WebauthnChallengePayload {
  challenge: string;
  purpose: WebauthnChallengePurpose;
  /** Present for "registration" only - the scope the new credential will be bound to. */
  tornFactionId?: number;
  keyFingerprint?: string;
  expiresAt: number;
}

/**
 * The challenge only needs to survive the two requests of one ceremony
 * (60-120s), not a server restart or another instance, so - like
 * `connection-session.ts`'s temporary session - it's a self-contained
 * encrypted cookie rather than a new server-side store.
 */
export function encodeWebauthnChallenge(payload: Omit<WebauthnChallengePayload, "expiresAt">): string {
  const full: WebauthnChallengePayload = { ...payload, expiresAt: Date.now() + WEBAUTHN_CHALLENGE_MAX_AGE_SECONDS * 1_000 };
  const encrypted = encryptCredential(JSON.stringify(full), credentialEncryptionSecret());
  return `v1.${encrypted.encryptionIv.toString("base64url")}.${encrypted.encryptedKey.toString("base64url")}`;
}

export function decodeWebauthnChallenge(value: string | undefined, expectedPurpose: WebauthnChallengePurpose): WebauthnChallengePayload | null {
  if (!value) return null;
  try {
    const [version, iv, encrypted] = value.split(".");
    if (version !== "v1" || !iv || !encrypted) return null;
    const plaintext = decryptCredential(Buffer.from(encrypted, "base64url"), Buffer.from(iv, "base64url"), credentialEncryptionSecret());
    const parsed = JSON.parse(plaintext) as Partial<WebauthnChallengePayload>;
    if (
      typeof parsed.challenge !== "string"
      || parsed.purpose !== expectedPurpose
      || typeof parsed.expiresAt !== "number"
      || parsed.expiresAt <= Date.now()
    ) return null;
    return parsed as WebauthnChallengePayload;
  } catch {
    return null;
  }
}

export function webauthnChallengeCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
    priority: "high" as const,
  };
}
