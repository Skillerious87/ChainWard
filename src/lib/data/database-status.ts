import "server-only";

import { cache } from "react";
import { localDatabaseExists, localDatabaseInfo, openLocalDatabase, openLocalTestDatabase } from "./local-database";

export interface DatabaseStatus {
  configured: boolean;
  available: boolean;
  label: string;
  message: string;
  provider: "none" | "sqlite" | "postgresql";
  filename: string | null;
}

export const getDatabaseStatus = cache(async (): Promise<DatabaseStatus> => {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) try {
    const { db } = await import("@/lib/db");
    await db.$queryRaw`SELECT 1`;
    const hostname = safeHostname(connectionString);
    const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "postgres";
    return { configured: true, available: true, label: local ? "Local PostgreSQL" : "PostgreSQL", message: local ? "Data is stored by the Chainward service on this device." : "The configured PostgreSQL service responded successfully.", provider: "postgresql", filename: null };
  } catch {
    return { configured: true, available: false, label: "Connection unavailable", message: "DATABASE_URL is set, but PostgreSQL did not respond.", provider: "postgresql", filename: null };
  }
  openLocalTestDatabase()?.close();
  if (localDatabaseExists()) {
    let database: ReturnType<typeof openLocalDatabase> = null;
    try {
      database = openLocalDatabase();
      if (!database) throw new Error("The local database disappeared before it could be opened.");
      database?.prepare("SELECT 1").get();
      const info = localDatabaseInfo();
      return { configured: true, available: true, label: "Temporary project SQLite", message: `${info.filename} is ready for local testing.`, provider: "sqlite", filename: info.filename };
    } catch {
      return { configured: true, available: false, label: "Local file unavailable", message: "The local SQLite file exists but could not be opened safely. Retry after any backup or restore operation finishes.", provider: "sqlite", filename: safeLocalFilename() };
    } finally { database?.close(); }
  }
  return { configured: false, available: false, label: "No local database", message: "Enable local test mode or configure PostgreSQL before saving workspace records.", provider: "none", filename: null };
});

function safeLocalFilename(): string {
  try { return localDatabaseInfo().filename; } catch { return "chainward-local.sqlite"; }
}

function safeHostname(connectionString: string): string {
  try { return new URL(connectionString).hostname; } catch { return "unknown"; }
}
