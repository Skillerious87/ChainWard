import "server-only";

import { decryptCredential, encryptCredential } from "@/lib/security/credential-encryption";
import { credentialEncryptionSecret } from "@/lib/security/credential-secret";
import { withDbRetry } from "@/lib/data/with-db-retry";
import { decryptAndMigratePostgresCredential } from "./remembered-connection";
import { openCredentialDatabase } from "./credential-database";

export interface WebauthnCredentialSummary {
  credentialId: string;
  transports?: string[];
}

export interface WebauthnAuthenticationCandidate {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  tornFactionId: number;
  keyFingerprint: string;
  /** The plaintext Torn API key this passkey unlocks, resolved for this one request only. */
  apiKey: string;
}

interface RegisterCredentialInput {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
  deviceLabel?: string;
  tornFactionId: number;
  keyFingerprint: string;
  /**
   * Local (sqlite) storage has no cookie-independent canonical credential row
   * to fall back on at authentication time, unlike Postgres's
   * FactionApiCredential, so it keeps its own encrypted copy here - consistent
   * with how local mode already stores one encrypted copy per remembered
   * browser rather than a single shared row.
   */
  apiKey: string;
}

export async function registerWebauthnCredential(input: RegisterCredentialInput): Promise<void> {
  if (process.env.DATABASE_URL?.trim()) return registerPostgresCredential(input);
  return registerLocalCredential(input);
}

export async function credentialExistsForFingerprint(keyFingerprint: string): Promise<boolean> {
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    const match = await withDbRetry(() => db.webAuthnCredential.findFirst({ where: { keyFingerprint }, select: { id: true } })).catch(() => null);
    return Boolean(match);
  }
  const database = openCredentialDatabase();
  try {
    const row = database.prepare("SELECT 1 FROM webauthn_credentials WHERE key_fingerprint = ? LIMIT 1").get(keyFingerprint);
    return Boolean(row);
  } finally {
    database.close();
  }
}

export async function listCredentialsForFingerprint(keyFingerprint: string): Promise<WebauthnCredentialSummary[]> {
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    const rows = await withDbRetry(() => db.webAuthnCredential.findMany({ where: { keyFingerprint }, select: { credentialId: true, transports: true } })).catch(() => []);
    return rows.map((row) => ({ credentialId: row.credentialId, transports: parseTransports(row.transports) }));
  }
  const database = openCredentialDatabase();
  try {
    const rows = database.prepare("SELECT credential_id, transports_json FROM webauthn_credentials WHERE key_fingerprint = ?").all(keyFingerprint) as unknown as Array<{ credential_id: string; transports_json: string }>;
    return rows.map((row) => ({ credentialId: row.credential_id, transports: parseTransports(row.transports_json) }));
  } finally {
    database.close();
  }
}

/**
 * Resolves everything needed to complete a WebAuthn authentication ceremony
 * purely from the credential ID in the assertion - the server never trusts a
 * client-supplied scope. Re-validating the returned apiKey against Torn is
 * the caller's responsibility.
 */
export async function resolveWebauthnCandidate(credentialId: string): Promise<WebauthnAuthenticationCandidate | null> {
  if (process.env.DATABASE_URL?.trim()) return resolvePostgresCandidate(credentialId);
  return resolveLocalCandidate(credentialId);
}

export async function updateWebauthnCounter(credentialId: string, counter: number): Promise<void> {
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await withDbRetry(() => db.webAuthnCredential.update({ where: { credentialId }, data: { counter: BigInt(counter), lastUsedAt: new Date() } })).catch(() => {});
    return;
  }
  const database = openCredentialDatabase();
  try {
    database.prepare("UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE credential_id = ?").run(counter, new Date().toISOString(), credentialId);
  } finally {
    database.close();
  }
}

export async function deleteWebauthnCredential(credentialId: string): Promise<void> {
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await withDbRetry(() => db.webAuthnCredential.delete({ where: { credentialId } })).catch(() => {});
    return;
  }
  const database = openCredentialDatabase();
  try {
    database.prepare("DELETE FROM webauthn_credentials WHERE credential_id = ?").run(credentialId);
  } finally {
    database.close();
  }
}

/** Called when the underlying remembered connection is revoked. */
export async function deleteWebauthnCredentialsForFingerprint(keyFingerprint: string): Promise<void> {
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await withDbRetry(() => db.webAuthnCredential.deleteMany({ where: { keyFingerprint } })).catch(() => {});
    return;
  }
  const database = openCredentialDatabase();
  try {
    database.prepare("DELETE FROM webauthn_credentials WHERE key_fingerprint = ?").run(keyFingerprint);
  } finally {
    database.close();
  }
}

async function registerPostgresCredential(input: RegisterCredentialInput): Promise<void> {
  const { db } = await import("@/lib/db");
  await db.webAuthnCredential.create({
    data: {
      credentialId: input.credentialId,
      publicKey: Buffer.from(input.publicKey),
      counter: BigInt(input.counter),
      tornFactionId: input.tornFactionId,
      keyFingerprint: input.keyFingerprint,
      transports: input.transports ?? [],
      deviceLabel: input.deviceLabel,
    },
  });
}

function registerLocalCredential(input: RegisterCredentialInput): void {
  const encrypted = encryptCredential(input.apiKey, credentialEncryptionSecret());
  const database = openCredentialDatabase();
  try {
    database.prepare(`
      INSERT INTO webauthn_credentials (
        credential_id, public_key, counter, torn_faction_id, key_fingerprint,
        transports_json, device_label, encrypted_key, encryption_iv, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.credentialId,
      Buffer.from(input.publicKey),
      input.counter,
      input.tornFactionId,
      input.keyFingerprint,
      JSON.stringify(input.transports ?? []),
      input.deviceLabel ?? null,
      encrypted.encryptedKey,
      encrypted.encryptionIv,
      new Date().toISOString(),
    );
  } finally {
    database.close();
  }
}

async function resolvePostgresCandidate(credentialId: string): Promise<WebauthnAuthenticationCandidate | null> {
  const { db } = await import("@/lib/db");
  const credential = await withDbRetry(() => db.webAuthnCredential.findUnique({ where: { credentialId } })).catch(() => null);
  if (!credential) return null;
  const stored = await withDbRetry(() => db.factionApiCredential.findUnique({ where: { keyFingerprint: credential.keyFingerprint } })).catch(() => null);
  if (!stored || stored.status !== "ACTIVE") return null;
  try {
    const apiKey = await decryptAndMigratePostgresCredential(stored);
    return {
      credentialId: credential.credentialId,
      publicKey: new Uint8Array(credential.publicKey),
      counter: Number(credential.counter),
      tornFactionId: credential.tornFactionId,
      keyFingerprint: credential.keyFingerprint,
      apiKey,
    };
  } catch {
    return null;
  }
}

function resolveLocalCandidate(credentialId: string): WebauthnAuthenticationCandidate | null {
  const database = openCredentialDatabase();
  try {
    const row = database.prepare(`
      SELECT credential_id, public_key, counter, torn_faction_id, key_fingerprint, encrypted_key, encryption_iv
      FROM webauthn_credentials WHERE credential_id = ?
    `).get(credentialId) as unknown as {
      credential_id: string;
      public_key: Uint8Array;
      counter: number;
      torn_faction_id: number;
      key_fingerprint: string;
      encrypted_key: Uint8Array;
      encryption_iv: Uint8Array;
    } | undefined;
    if (!row) return null;
    const apiKey = decryptCredential(row.encrypted_key, row.encryption_iv, credentialEncryptionSecret());
    return {
      credentialId: row.credential_id,
      publicKey: new Uint8Array(row.public_key),
      counter: row.counter,
      tornFactionId: row.torn_faction_id,
      keyFingerprint: row.key_fingerprint,
      apiKey,
    };
  } catch {
    return null;
  } finally {
    database.close();
  }
}

function parseTransports(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
