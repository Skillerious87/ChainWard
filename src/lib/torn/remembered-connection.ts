import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createLocalDatabase, openLocalDatabase } from "@/lib/data/local-database";
import { decryptCredential, encryptCredential } from "@/lib/security/credential-encryption";
import type { ValidatedTornConnection } from "./connection-service";
import { connectionEncryptionSecret } from "./connection-session";

export const REMEMBERED_CONNECTION_COOKIE = "chainward_remembered_connection";
export const REMEMBERED_CONNECTION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface RememberedConnection {
  apiKey: string;
  tornUserId: number;
  factionId: number;
  expiresAt: number;
}

interface LocalRememberedRow {
  torn_user_id: number;
  faction_id: number;
  encrypted_key: Uint8Array;
  encryption_iv: Uint8Array;
  expires_at: string;
  last_seen_at: string;
}

export async function createRememberedConnection(
  apiKey: string,
  connection: ValidatedTornConnection,
): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + REMEMBERED_CONNECTION_MAX_AGE_SECONDS * 1_000;
  const encrypted = encryptCredential(apiKey, connectionEncryptionSecret());

  if (process.env.DATABASE_URL?.trim()) {
    await createPostgresConnection(tokenHash, expiresAt, encrypted, connection);
  } else {
    createLocalConnection(tokenHash, expiresAt, encrypted, connection);
  }

  return { token, expiresAt };
}

export async function readRememberedConnection(token: string | undefined): Promise<RememberedConnection | null> {
  if (!token || token.length < 32) return null;
  return process.env.DATABASE_URL?.trim()
    ? readPostgresConnection(hashToken(token))
    : readLocalConnection(hashToken(token));
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
  const database = openLocalDatabase() ?? (createLocalDatabase(), openLocalDatabase());
  if (!database) throw new Error("The local connection store could not be opened.");
  const now = new Date().toISOString();
  try {
    database.prepare(`
      INSERT INTO remembered_torn_connections (
        token_hash, torn_user_id, torn_user_name, faction_id, faction_name, faction_tag,
        encrypted_key, encryption_iv, key_fingerprint, key_last_four, access_type,
        selections_json, expires_at, last_seen_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tokenHash,
      connection.player.id,
      connection.player.name,
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

function readLocalConnection(tokenHash: string): RememberedConnection | null {
  const database = openLocalDatabase();
  if (!database) return null;
  try {
    const row = database.prepare(`
      SELECT torn_user_id, faction_id, encrypted_key, encryption_iv, expires_at, last_seen_at
      FROM remembered_torn_connections WHERE token_hash = ?
    `).get(tokenHash) as unknown as LocalRememberedRow | undefined;
    if (!row) return null;
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
      apiKey: decryptCredential(row.encrypted_key, row.encryption_iv, connectionEncryptionSecret()),
      tornUserId: row.torn_user_id,
      factionId: row.faction_id,
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
  const database = openLocalDatabase();
  if (!database) return;
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
  const user = await db.user.upsert({
    where: { tornUserId: connection.player.id },
    update: { name: connection.player.name, lastAuthenticatedAt: new Date() },
    create: { tornUserId: connection.player.id, name: connection.player.name, lastAuthenticatedAt: new Date() },
  });
  const faction = await db.faction.upsert({
    where: { tornFactionId: connection.faction.id },
    update: { name: connection.faction.name, tag: connection.faction.tag },
    create: { tornFactionId: connection.faction.id, name: connection.faction.name, tag: connection.faction.tag },
  });
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

async function readPostgresConnection(tokenHash: string): Promise<RememberedConnection | null> {
  const { db } = await import("@/lib/db");
  const session = await db.session.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await db.session.delete({ where: { id: session.id } });
    return null;
  }
  const credential = await db.factionApiCredential.findFirst({
    where: { ownerTornUserId: session.user.tornUserId, status: "ACTIVE" },
    include: { faction: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!credential) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 24 * 60 * 60 * 1_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  try {
    return {
      apiKey: decryptCredential(credential.encryptedKey, credential.encryptionIv, connectionEncryptionSecret()),
      tornUserId: session.user.tornUserId,
      factionId: credential.faction.tornFactionId,
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
