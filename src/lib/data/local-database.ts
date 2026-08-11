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

export function openLocalTestDatabase(): DatabaseSync | null {
  if (!localDatabaseExists() && localTestingEnabled()) createLocalDatabase();
  return openLocalDatabase();
}

export function localTestingEnabled(): boolean {
  if (process.env.DATABASE_URL?.trim()) return false;
  const configured = process.env.CHAINWARD_LOCAL_TEST_MODE?.trim().toLowerCase();
  if (configured === "false" || configured === "0") return false;
  return configured === "true" || configured === "1" || process.env.NODE_ENV !== "production";
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

    /* Withdrawing a payout deletes its settlement row, so the correction is
       recorded here with the operator's stated reason. Without it the ledger
       would simply forget that a chain had ever been marked paid. */
    CREATE TABLE IF NOT EXISTS chain_settlement_reverts (
      id TEXT PRIMARY KEY,
      faction_id INTEGER NOT NULL,
      chain_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      scheme_name TEXT,
      scheme_version INTEGER,
      reward_unit TEXT,
      total_amount REAL,
      member_count INTEGER,
      paid_at TEXT,
      paid_by_name TEXT,
      reverted_at TEXT NOT NULL,
      reverted_by_torn_id INTEGER NOT NULL,
      reverted_by_name TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS licensing_users (
      torn_user_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      is_platform_admin INTEGER NOT NULL DEFAULT 0,
      last_authenticated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS licensing_factions (
      faction_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS licensing_access_requests (
      id TEXT PRIMARY KEY,
      faction_id INTEGER NOT NULL REFERENCES licensing_factions(faction_id) ON DELETE RESTRICT,
      submitted_by_torn_id INTEGER NOT NULL REFERENCES licensing_users(torn_user_id) ON DELETE RESTRICT,
      reviewed_by_torn_id INTEGER REFERENCES licensing_users(torn_user_id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'INFORMATION_REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED')) DEFAULT 'PENDING',
      reference TEXT NOT NULL UNIQUE,
      customer_note TEXT,
      private_note TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS licensing_faction_licenses (
      id TEXT PRIMARY KEY,
      faction_id INTEGER NOT NULL REFERENCES licensing_factions(faction_id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED', 'REJECTED')) DEFAULT 'PENDING',
      term TEXT NOT NULL CHECK (term IN ('PERMANENT', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM')),
      reference TEXT NOT NULL UNIQUE,
      issued_at TEXT,
      expires_at TEXT,
      approved_by_torn_id INTEGER REFERENCES licensing_users(torn_user_id) ON DELETE SET NULL,
      payment_notes TEXT,
      internal_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS licensing_audit (
      id TEXT PRIMARY KEY,
      faction_id INTEGER REFERENCES licensing_factions(faction_id) ON DELETE RESTRICT,
      actor_torn_user_id INTEGER REFERENCES licensing_users(torn_user_id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS reward_schemes_faction_status ON reward_schemes(faction_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS chain_settlements_faction_status ON chain_settlements(faction_id, status, paid_at);
    CREATE INDEX IF NOT EXISTS faction_access_status ON faction_access_assignments(faction_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS faction_access_audit_recent ON faction_access_audit(faction_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS member_activity_audit_recent ON member_activity_audit(faction_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS licensing_requests_status ON licensing_access_requests(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS licensing_requests_faction ON licensing_access_requests(faction_id, status);
    CREATE INDEX IF NOT EXISTS licensing_licenses_faction ON licensing_faction_licenses(faction_id, status, expires_at);
    CREATE INDEX IF NOT EXISTS licensing_audit_recent ON licensing_audit(action, created_at DESC);
    CREATE INDEX IF NOT EXISTS chain_settlement_reverts_recent ON chain_settlement_reverts(faction_id, reverted_at DESC);
  `);
  ensureColumn(database, "chain_settlements", "paid_by_name", "TEXT");
}

function ensureColumn(database: DatabaseSync, table: string, column: string, declaration: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
