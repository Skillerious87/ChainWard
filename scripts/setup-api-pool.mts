import { readFile } from "node:fs/promises";
import nextEnv from "@next/env";
import pg from "pg";
import { withExplicitPostgresSslMode } from "../src/lib/data/postgres-connection.ts";

nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("Configure DATABASE_URL before setting up the hosted API pool.");
const pool = new pg.Pool({ connectionString: withExplicitPostgresSslMode(connectionString), connectionTimeoutMillis: 10_000 });
try {
  const sql = await readFile(new URL("../prisma/torn-api-broker-state.sql", import.meta.url), "utf8");
  await pool.query(sql);
  console.log("API pool coordination table and expiry index are ready. Existing application tables are unchanged.");
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  console.error(`API pool setup failed (${code}). Check database connectivity and schema permissions.`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
