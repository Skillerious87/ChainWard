import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { openCredentialDatabase } from "./credential-database";

let nextPostgresCleanupAt = 0;

export interface ApiStateWrite {
  value: unknown;
  expiresAt: number | null;
}

export interface ApiStateUpdate<Result> {
  result: Result;
  changes: Record<string, ApiStateWrite>;
}

export interface ApiStateStore {
  read(key: string): Promise<unknown>;
  list(prefix: string): Promise<Array<{ key: string; value: unknown }>>;
  transact<Result>(keys: string[], update: (values: Record<string, unknown>) => ApiStateUpdate<Result>): Promise<Result>;
}

export function apiState(value: unknown, expiresAt: number | null = null): ApiStateWrite {
  return { value, expiresAt };
}

function openStateDatabase() {
  const database = openCredentialDatabase();
  database.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS torn_api_broker_state (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS torn_api_broker_state_expiry ON torn_api_broker_state(expires_at);
  `);
  return database;
}

export const apiStateStore: ApiStateStore = {
  async read(key) {
    if (process.env.DATABASE_URL?.trim()) {
      const { db } = await import("@/lib/db");
      const row = await db.tornApiBrokerState.findUnique({ where: { key } });
      return row && (!row.expiresAt || row.expiresAt.getTime() > Date.now()) ? row.value : undefined;
    }
    const database = openStateDatabase();
    try {
      const row = database.prepare("SELECT value_json FROM torn_api_broker_state WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)").get(key, Date.now()) as { value_json: string } | undefined;
      return row ? JSON.parse(row.value_json) : undefined;
    } finally {
      database.close();
    }
  },
  async list(prefix) {
    if (process.env.DATABASE_URL?.trim()) {
      const { db } = await import("@/lib/db");
      return db.tornApiBrokerState.findMany({ where: { key: { startsWith: prefix }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { key: true, value: true } });
    }
    const database = openStateDatabase();
    try {
      const rows = database.prepare("SELECT key, value_json FROM torn_api_broker_state WHERE substr(key, 1, ?) = ? AND (expires_at IS NULL OR expires_at > ?)").all(prefix.length, prefix, Date.now()) as unknown as Array<{ key: string; value_json: string }>;
      return rows.map((row) => ({ key: row.key, value: JSON.parse(row.value_json) as unknown }));
    } finally {
      database.close();
    }
  },
  async transact(keys, update) {
    const orderedKeys = [...new Set(keys)].sort();
    if (process.env.DATABASE_URL?.trim()) {
      const { db } = await import("@/lib/db");
      const result = await db.$transaction(async (transaction) => {
        for (const key of orderedKeys) {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chainward:torn:${key}`}, 0))`;
        }
        const rows = await transaction.tornApiBrokerState.findMany({ where: { key: { in: orderedKeys }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
        const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
        const updated = update(values);
        for (const [key, entry] of Object.entries(updated.changes)) {
          if (!orderedKeys.includes(key)) throw new Error("Unreserved Torn coordination state.");
          const data = { value: entry.value as Prisma.InputJsonValue, expiresAt: entry.expiresAt === null ? null : new Date(entry.expiresAt) };
          await transaction.tornApiBrokerState.upsert({ where: { key }, create: { key, ...data }, update: data });
        }
        return updated.result;
      }, { maxWait: 15_000, timeout: 10_000 });
      if (Date.now() >= nextPostgresCleanupAt) {
        nextPostgresCleanupAt = Date.now() + 60_000;
        await db.tornApiBrokerState.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60_000) } } }).catch(() => undefined);
      }
      return result;
    }
    const database = openStateDatabase();
    try {
      database.exec("BEGIN IMMEDIATE");
      const values: Record<string, unknown> = {};
      for (const key of orderedKeys) {
        const row = database.prepare("SELECT value_json FROM torn_api_broker_state WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)").get(key, Date.now()) as { value_json: string } | undefined;
        if (row) values[key] = JSON.parse(row.value_json) as unknown;
      }
      const updated = update(values);
      for (const [key, entry] of Object.entries(updated.changes)) {
        if (!orderedKeys.includes(key)) throw new Error("Unreserved Torn coordination state.");
        database.prepare("INSERT INTO torn_api_broker_state (key, value_json, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, expires_at = excluded.expires_at")
          .run(key, JSON.stringify(entry.value), entry.expiresAt);
      }
      database.prepare("DELETE FROM torn_api_broker_state WHERE expires_at < ?").run(Date.now() - 60_000);
      database.exec("COMMIT");
      return updated.result;
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    } finally {
      database.close();
    }
  },
};
