import "server-only";

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { chainwardAppDataDirectory, migrateLegacyConnectionSecret } from "@/lib/data/app-data";
import { localDatabasePath } from "@/lib/data/local-database";
import { openSqliteDatabase } from "@/lib/data/sqlite-database";

export function credentialDatabasePath(): string {
  return path.join(chainwardAppDataDirectory(), "credentials.sqlite");
}

export function openCredentialDatabase(): DatabaseSync {
  const databasePath = credentialDatabasePath();
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = openSqliteDatabase(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;

    CREATE TABLE IF NOT EXISTS remembered_torn_connections (
      token_hash TEXT PRIMARY KEY,
      torn_user_id INTEGER NOT NULL,
      torn_user_name TEXT NOT NULL,
      torn_user_image_url TEXT,
      faction_id INTEGER NOT NULL,
      faction_name TEXT NOT NULL,
      faction_tag TEXT NOT NULL DEFAULT '',
      encrypted_key BLOB NOT NULL,
      encryption_iv BLOB NOT NULL,
      key_fingerprint TEXT NOT NULL,
      key_last_four TEXT NOT NULL,
      access_type TEXT NOT NULL,
      selections_json TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS remembered_torn_connections_user
      ON remembered_torn_connections(torn_user_id, expires_at);
  `);
  ensureCredentialColumns(database);
  migrateLegacyCredentialRows(database);
  return database;
}

function ensureCredentialColumns(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(remembered_torn_connections)").all() as unknown as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "torn_user_image_url")) {
    database.exec("ALTER TABLE remembered_torn_connections ADD COLUMN torn_user_image_url TEXT");
  }
}

function migrateLegacyCredentialRows(destination: DatabaseSync): void {
  const legacyPath = localDatabasePath();
  if (!existsSync(legacyPath) || path.resolve(legacyPath) === path.resolve(credentialDatabasePath())) return;
  if (!migrateLegacyConnectionSecret() && !process.env.SESSION_SECRET?.trim()) return;

  const legacy = openSqliteDatabase(legacyPath);
  try {
    const table = legacy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'remembered_torn_connections'").get();
    if (!table) return;
    const rows = legacy.prepare("SELECT * FROM remembered_torn_connections").all() as unknown as Array<Record<string, unknown>>;
    destination.exec("BEGIN IMMEDIATE");
    try {
      const insert = destination.prepare(`
        INSERT OR IGNORE INTO remembered_torn_connections (
          token_hash, torn_user_id, torn_user_name, torn_user_image_url, faction_id, faction_name, faction_tag,
          encrypted_key, encryption_iv, key_fingerprint, key_last_four, access_type,
          selections_json, expires_at, last_seen_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of rows) {
        insert.run(
          row.token_hash as string,
          row.torn_user_id as number,
          row.torn_user_name as string,
          (row.torn_user_image_url as string | undefined) ?? null,
          row.faction_id as number,
          row.faction_name as string,
          row.faction_tag as string,
          row.encrypted_key as Uint8Array,
          row.encryption_iv as Uint8Array,
          row.key_fingerprint as string,
          row.key_last_four as string,
          row.access_type as string,
          row.selections_json as string,
          row.expires_at as string,
          row.last_seen_at as string,
          row.created_at as string,
        );
      }
      destination.exec("COMMIT");
    } catch (error) {
      destination.exec("ROLLBACK");
      throw error;
    }

    legacy.exec("DROP INDEX IF EXISTS remembered_torn_connections_user; DROP TABLE remembered_torn_connections; VACUUM;");
  } finally {
    legacy.close();
  }
}
