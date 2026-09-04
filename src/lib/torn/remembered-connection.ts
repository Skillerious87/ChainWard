import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { decryptCredential, encryptCredential } from "@/lib/security/credential-encryption";
import { credentialEncryptionSecret } from "@/lib/security/credential-secret";
import type { ValidatedTornConnection } from "./connection-service";
import { connectionEncryptionSecret } from "./connection-session";
import { openCredentialDatabase } from "./credential-database";

export const REMEMBERED_CONNECTION_COOKIE = "chainward_remembered_connection";
export const REMEMBERED_CONNECTION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface RememberedConnection {
  apiKey: string;
  tornUserId: number;
  tornUserName: string;
  tornUserImageUrl: string | null;
  factionId: number;
  factionName: string;
  factionTag: string;
  expiresAt: number;
}

interface LocalRememberedRow {
  torn_user_id: number;
  torn_user_name: string;
  torn_user_image_url: string | null;
  faction_id: number;
  faction_name: string;
  faction_tag: string;
  encrypted_key: Uint8Array;
  encryption_iv: Uint8Array;
  expires_at: string;
  last_seen_at: string;
}

export async function createRememberedConnection(
  apiKey: string,
  connection: ValidatedTornConnection,
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + REMEMBERED_CONNECTION_MAX_AGE_SECONDS * 1_000;
  const encrypted = encryptCredential(apiKey, credentialEncryptionSecret());
  // The random secret remains opaque, while the non-secret scope makes the
  // database lookup unambiguous. A session opened for one faction therefore
  // cannot silently follow a newer credential belonging to the same player.
  const token = `v1.${randomBytes(32).toString("base64url")}.${connection.faction.id}.${encrypted.fingerprint}`;
  const tokenHash = hashToken(token);

  if (process.env.DATABASE_URL?.trim()) {
    await createPostgresConnection(tokenHash, expiresAt, encrypted, connection);
  } else {
    createLocalConnection(tokenHash, expiresAt, encrypted, connection);
  }

  return { token, expiresAt };
}

export async function readRememberedConnection(token: string | undefined): Promise<RememberedConnection | null> {
  const scope = parseRememberedToken(token);
  if (!token || !scope) return null;
  return process.env.DATABASE_URL?.trim()
    ? readPostgresConnection(hashToken(token), scope)
    : readLocalConnection(hashToken(token), scope);
}

export async function revokeRememberedConnection(token: string | undefined): Promise<void> {
  if (!token || token.length < 32) return;
  if (process.env.DATABASE_URL?.trim()) await revokePostgresConnection(hashToken(token));
  else revokeLocalConnection(hashToken(token));
}

function createLocalConnection(
  tokenHash: string,
  expiresAt: number,
  encrypted: ReturnType<typeof encryptCredential>,
  connection: ValidatedTornConnection,
): void {
  const database = openCredentialDatabase();
  const now = new Date().toISOString();
  try {
    database.prepare(`
      INSERT INTO remembered_torn_connections (
        token_hash, torn_user_id, torn_user_name, torn_user_image_url, faction_id, faction_name, faction_tag,
        encrypted_key, encryption_iv, key_fingerprint, key_last_four, access_type,
        selections_json, expires_at, last_seen_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tokenHash,
      connection.player.id,
      connection.player.name,
      connection.player.imageUrl,
      connection.faction.id,
      connection.faction.name,
      connection.faction.tag,
      encrypted.encryptedKey,
      encrypted.encryptionIv,
      encrypted.fingerprint,
      encrypted.lastFour,
      connection.key.accessType,
      JSON.stringify(connection.key.selections),
      new Date(expiresAt).toISOString(),
      now,
      now,
    );
  } finally {
    database.close();
  }
}

function readLocalConnection(tokenHash: string, scope: RememberedTokenScope): RememberedConnection | null {
  const database = openCredentialDatabase();
  try {
    const row = database.prepare(`
      SELECT torn_user_id, torn_user_name, torn_user_image_url, faction_id, faction_name, faction_tag,
             encrypted_key, encryption_iv, expires_at, last_seen_at
      FROM remembered_torn_connections WHERE token_hash = ?
    `).get(tokenHash) as unknown as LocalRememberedRow | undefined;
    if (!row) return null;
    if (row.faction_id !== scope.factionId) {
      database.prepare("DELETE FROM remembered_torn_connections WHERE token_hash = ?").run(tokenHash);
      return null;
    }
    const expiresAt = Date.parse(row.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      database.prepare("DELETE FROM remembered_torn_connections WHERE token_hash = ?").run(tokenHash);
      return null;
    }
    const lastSeenAt = Date.parse(row.last_seen_at);
    if (!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt > 24 * 60 * 60 * 1_000) {
      database.prepare("UPDATE remembered_torn_connections SET last_seen_at = ? WHERE token_hash = ?").run(new Date().toISOString(), tokenHash);
    }
    return {
      apiKey: decryptAndMigrateLocalCredential(database, tokenHash, row),
      tornUserId: row.torn_user_id,
      tornUserName: row.torn_user_name,
      tornUserImageUrl: row.torn_user_image_url,
      factionId: row.faction_id,
      factionName: row.faction_name,
      factionTag: row.faction_tag,
      expiresAt,
    };
  } catch {
    database.prepare("DELETE FROM remembered_torn_connections WHERE token_hash = ?").run(tokenHash);
    return null;
  } finally {
    database.close();
  }
}

function revokeLocalConnection(tokenHash: string): void {
  const database = openCredentialDatabase();
  try {
    const row = database.prepare("SELECT torn_user_id FROM remembered_torn_connections WHERE token_hash = ?").get(tokenHash) as unknown as { torn_user_id: number } | undefined;
    if (row) database.prepare("DELETE FROM remembered_torn_connections WHERE torn_user_id = ?").run(row.torn_user_id);
  } finally {
    database.close();
  }
}

async function createPostgresConnection(
  tokenHash: string,
  expiresAt: number,
  encrypted: ReturnType<typeof encryptCredential>,
  connection: ValidatedTornConnection,
): Promise<void> {
  const { db } = await import("@/lib/db");
  const encryptedKey = Uint8Array.from(encrypted.encryptedKey);
  const encryptionIv = Uint8Array.from(encrypted.encryptionIv);
  const [user, faction] = await Promise.all([
    db.user.upsert({
      where: { tornUserId: connection.player.id },
      update: { name: connection.player.name, avatarUrl: connection.player.imageUrl, lastAuthenticatedAt: new Date() },
      create: { tornUserId: connection.player.id, name: connection.player.name, avatarUrl: connection.player.imageUrl, lastAuthenticatedAt: new Date() },
    }),
    db.faction.upsert({
      where: { tornFactionId: connection.faction.id },
      update: { name: connection.faction.name, tag: connection.faction.tag },
      create: { tornFactionId: connection.faction.id, name: connection.faction.name, tag: connection.faction.tag },
    }),
  ]);
  await db.factionApiCredential.upsert({
    where: { keyFingerprint: encrypted.fingerprint },
    update: {
      factionId: faction.id,
      ownerTornUserId: connection.player.id,
      encryptedKey,
      encryptionIv,
      keyLastFour: encrypted.lastFour,
      accessType: connection.key.accessType,
      selections: connection.key.selections,
      status: "ACTIVE",
      lastValidatedAt: new Date(connection.checkedAt),
    },
    create: {
      factionId: faction.id,
      ownerTornUserId: connection.player.id,
      encryptedKey,
      encryptionIv,
      keyFingerprint: encrypted.fingerprint,
      keyLastFour: encrypted.lastFour,
      accessType: connection.key.accessType,
      selections: connection.key.selections,
      status: "ACTIVE",
      lastValidatedAt: new Date(connection.checkedAt),
    },
  });
  await db.session.create({ data: { tokenHash, userId: user.id, expiresAt: new Date(expiresAt) } });
}

async function readPostgresConnection(tokenHash: string, scope: RememberedTokenScope): Promise<RememberedConnection | null> {
  const { db } = await import("@/lib/db");
  // Both lookups are fully scoped by the opaque token. Running them together
  // removes a database-network waterfall from every authenticated request;
  // the owner IDs are still compared before the credential is accepted.
  const [session, credential] = await Promise.all([
    db.session.findUnique({ where: { tokenHash }, include: { user: true } }),
    db.factionApiCredential.findFirst({
      where: {
        keyFingerprint: scope.keyFingerprint,
        faction: { tornFactionId: scope.factionId },
        status: "ACTIVE",
      },
      include: { faction: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await db.session.delete({ where: { id: session.id } });
    return null;
  }
  if (!credential || credential.ownerTornUserId !== session.user.tornUserId) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 24 * 60 * 60 * 1_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  try {
    return {
      apiKey: await decryptAndMigratePostgresCredential(credential),
      tornUserId: session.user.tornUserId,
      tornUserName: session.user.name,
      tornUserImageUrl: session.user.avatarUrl,
      factionId: credential.faction.tornFactionId,
      factionName: credential.faction.name,
      factionTag: credential.faction.tag ?? "",
      expiresAt: session.expiresAt.getTime(),
    };
  } catch {
    await db.session.delete({ where: { id: session.id } });
    return null;
  }
}

async function revokePostgresConnection(tokenHash: string): Promise<void> {
  const { db } = await import("@/lib/db");
  const session = await db.session.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!session) return;
  await db.$transaction([
    db.session.deleteMany({ where: { userId: session.userId } }),
    db.factionApiCredential.deleteMany({ where: { ownerTornUserId: session.user.tornUserId } }),
  ]);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface RememberedTokenScope {
  factionId: number;
  keyFingerprint: string;
}

function parseRememberedToken(token: string | undefined): RememberedTokenScope | null {
  if (!token) return null;
  const [version, secret, factionIdValue, keyFingerprint] = token.split(".");
  const factionId = Number(factionIdValue);
  if (
    version !== "v1"
    || !/^[A-Za-z0-9_-]{43}$/.test(secret ?? "")
    || !Number.isSafeInteger(factionId)
    || factionId <= 0
    || !/^[a-f0-9]{64}$/.test(keyFingerprint ?? "")
  ) return null;
  return { factionId, keyFingerprint: keyFingerprint! };
}

function decryptAndMigrateLocalCredential(
  database: ReturnType<typeof openCredentialDatabase>,
  tokenHash: string,
  row: LocalRememberedRow,
): string {
  const dedicatedSecret = credentialEncryptionSecret();
  try {
    return decryptCredential(row.encrypted_key, row.encryption_iv, dedicatedSecret);
  } catch {
    const plaintext = decryptCredential(row.encrypted_key, row.encryption_iv, connectionEncryptionSecret());
    const migrated = encryptCredential(plaintext, dedicatedSecret);
    database.prepare(`
      UPDATE remembered_torn_connections
      SET encrypted_key = ?, encryption_iv = ?, key_fingerprint = ?, key_last_four = ?
      WHERE token_hash = ?
    `).run(migrated.encryptedKey, migrated.encryptionIv, migrated.fingerprint, migrated.lastFour, tokenHash);
    return plaintext;
  }
}

async function decryptAndMigratePostgresCredential(credential: {
  id: string;
  encryptedKey: Uint8Array;
  encryptionIv: Uint8Array;
}): Promise<string> {
  const dedicatedSecret = credentialEncryptionSecret();
  try {
    return decryptCredential(credential.encryptedKey, credential.encryptionIv, dedicatedSecret);
  } catch {
    const plaintext = decryptCredential(credential.encryptedKey, credential.encryptionIv, connectionEncryptionSecret());
    const migrated = encryptCredential(plaintext, dedicatedSecret);
    const { db } = await import("@/lib/db");
    await db.factionApiCredential.update({
      where: { id: credential.id },
      data: {
        encryptedKey: Uint8Array.from(migrated.encryptedKey),
        encryptionIv: Uint8Array.from(migrated.encryptionIv),
        keyFingerprint: migrated.fingerprint,
        keyLastFour: migrated.lastFour,
      },
    });
    return plaintext;
  }
}
