import "server-only";

import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DATABASE_PATH = path.join(process.cwd(), "data", "chainward-local.sqlite");

export interface LocalDatabaseInfo {
  path: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export function localDatabasePath(): string {
  const configured = process.env.CHAINWARD_LOCAL_DB_PATH?.trim();
  return configured ? path.resolve(configured) : DEFAULT_DATABASE_PATH;
}

export function localDatabaseExists(): boolean {
  return existsSync(localDatabasePath());
}

export function createLocalDatabase(): LocalDatabaseInfo {
  const databasePath = localDatabasePath();
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try { initializeSchema(database); } finally { database.close(); }
  return localDatabaseInfo();
}

export function openLocalDatabase(): DatabaseSync | null {
  if (!localDatabaseExists()) return null;
  const database = new DatabaseSync(localDatabasePath());
  initializeSchema(database);
  return database;
}

export function localDatabaseInfo(): LocalDatabaseInfo {
  const databasePath = localDatabasePath();
  const stats = statSync(databasePath);
  return { path: databasePath, filename: path.basename(databasePath), sizeBytes: stats.size, createdAt: stats.birthtime.toISOString() };
}

function initializeSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS reward_schemes (
      id TEXT PRIMARY KEY,
      faction_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')) DEFAULT 'ACTIVE',
      is_default INTEGER NOT NULL DEFAULT 0,
      reward_name TEXT NOT NULL,
      reward_unit TEXT NOT NULL,
      locked_by_history INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (faction_id, name, version)
    );

    CREATE TABLE IF NOT EXISTS reward_tiers (
      id TEXT PRIMARY KEY,
      scheme_id TEXT NOT NULL REFERENCES reward_schemes(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      minimum_hits INTEGER NOT NULL,
      maximum_hits INTEGER,
      amount REAL NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL,
      UNIQUE (scheme_id, position)
    );

    CREATE TABLE IF NOT EXISTS chain_settlements (
      faction_id INTEGER NOT NULL,
      chain_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('READY', 'PAID')) DEFAULT 'READY',
      scheme_id TEXT,
      scheme_name TEXT NOT NULL,
      scheme_version INTEGER NOT NULL,
      reward_unit TEXT NOT NULL,
      total_amount REAL NOT NULL,
      member_count INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      calculated_at TEXT NOT NULL,
      paid_at TEXT,
      paid_by_torn_id INTEGER,
      paid_by_name TEXT,
      PRIMARY KEY (faction_id, chain_id)
    );

    CREATE TABLE IF NOT EXISTS faction_settings (
      faction_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (faction_id, key)
    );

    CREATE TABLE IF NOT EXISTS faction_access_assignments (
      faction_id INTEGER NOT NULL,
      torn_user_id INTEGER NOT NULL,
      member_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMINISTRATOR', 'CHAIN_MANAGER', 'VIEWER')),
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REMOVED')) DEFAULT 'ACTIVE',
      assigned_by_torn_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (faction_id, torn_user_id)
    );

    CREATE TABLE IF NOT EXISTS faction_access_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      faction_id INTEGER NOT NULL,
      torn_user_id INTEGER NOT NULL,
      member_name TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('GRANTED', 'UPDATED', 'SUSPENDED', 'REVOKED')),
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      actor_torn_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS member_activity_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      faction_id INTEGER NOT NULL,
      torn_user_id INTEGER NOT NULL,
      member_name TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('HOLIDAY_SET', 'WATCH_SET', 'UPDATED', 'CLEARED')),
      state TEXT NOT NULL CHECK (state IN ('HOLIDAY', 'WATCH', 'STANDARD')),
      holiday_until TEXT,
      note TEXT NOT NULL DEFAULT '',
      actor_torn_user_id INTEGER NOT NULL,
      actor_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS remembered_torn_connections (
      token_hash TEXT PRIMARY KEY,
      torn_user_id INTEGER NOT NULL,
      torn_user_name TEXT NOT NULL,
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

    CREATE INDEX IF NOT EXISTS reward_schemes_faction_status ON reward_schemes(faction_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS chain_settlements_faction_status ON chain_settlements(faction_id, status, paid_at);
    CREATE INDEX IF NOT EXISTS faction_access_status ON faction_access_assignments(faction_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS faction_access_audit_recent ON faction_access_audit(faction_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS member_activity_audit_recent ON member_activity_audit(faction_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS remembered_torn_connections_user ON remembered_torn_connections(torn_user_id, expires_at);
  `);
  ensureColumn(database, "chain_settlements", "paid_by_name", "TEXT");
}

function ensureColumn(database: DatabaseSync, table: string, column: string, declaration: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
