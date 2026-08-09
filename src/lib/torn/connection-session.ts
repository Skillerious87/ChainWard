import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connectionSecretPath, migrateLegacyConnectionSecret } from "@/lib/data/app-data";
import { decryptCredential, encryptCredential } from "@/lib/security/credential-encryption";

export const CONNECTION_COOKIE = "chainward_connection";
export const CONNECTION_MAX_AGE_SECONDS = 12 * 60 * 60;

interface ConnectionSessionPayload {
  apiKey: string;
  tornUserId: number;
  factionId: number;
  expiresAt: number;
}

const globalSession = globalThis as typeof globalThis & { chainwardEphemeralSessionSecret?: string };

export function createConnectionSession(apiKey: string, tornUserId: number, factionId: number): string {
  const payload: ConnectionSessionPayload = { apiKey, tornUserId, factionId, expiresAt: Date.now() + CONNECTION_MAX_AGE_SECONDS * 1_000 };
  const encrypted = encryptCredential(JSON.stringify(payload), connectionEncryptionSecret());
  return `v1.${encrypted.encryptionIv.toString("base64url")}.${encrypted.encryptedKey.toString("base64url")}`;
}

export function readConnectionSession(value: string | undefined): ConnectionSessionPayload | null {
  if (!value) return null;
  try {
    const [version, iv, encrypted] = value.split(".");
    if (version !== "v1" || !iv || !encrypted) return null;
    const plaintext = decryptCredential(Buffer.from(encrypted, "base64url"), Buffer.from(iv, "base64url"), connectionEncryptionSecret());
    const parsed = JSON.parse(plaintext) as Partial<ConnectionSessionPayload>;
    if (typeof parsed.apiKey !== "string" || typeof parsed.tornUserId !== "number" || typeof parsed.factionId !== "number" || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now()) return null;
    return parsed as ConnectionSessionPayload;
  } catch {
    return null;
  }
}

export function connectionEncryptionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) return createHash("sha256").update(configured).digest("base64");
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be configured before accepting Torn API connections.");
  globalSession.chainwardEphemeralSessionSecret ??= readOrCreateLocalSecret();
  return globalSession.chainwardEphemeralSessionSecret;
}

function readOrCreateLocalSecret(): string {
  const secretPath = connectionSecretPath();
  migrateLegacyConnectionSecret();
  if (existsSync(secretPath)) {
    const stored = readFileSync(secretPath, "utf8").trim();
    if (Buffer.from(stored, "base64").length === 32) return stored;
    throw new Error("The Chainward AppData encryption secret is malformed. Remove it and reconnect the Torn API.");
  }

  mkdirSync(path.dirname(secretPath), { recursive: true });
  const generated = randomBytes(32).toString("base64");
  try {
    writeFileSync(secretPath, generated, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return generated;
  } catch (error: unknown) {
    if (existsSync(secretPath)) {
      const stored = readFileSync(secretPath, "utf8").trim();
      if (Buffer.from(stored, "base64").length === 32) return stored;
    }
    throw error;
  }
}
