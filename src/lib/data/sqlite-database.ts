import "server-only";

import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

type DatabaseSyncConstructor = new (databasePath: string) => DatabaseSync;

const requireFromProject = createRequire(path.join(process.cwd(), "package.json"));
let databaseConstructor: DatabaseSyncConstructor | undefined;

/**
 * Loads Node's SQLite implementation only when the local backend is opened.
 * Importing a route that supports both PostgreSQL and SQLite must not activate
 * an experimental local-only module in a hosted PostgreSQL process.
 */
export function openSqliteDatabase(databasePath: string): DatabaseSync {
  databaseConstructor ??= (requireFromProject("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor }).DatabaseSync;
  return new databaseConstructor(databasePath);
}
