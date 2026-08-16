import { performance } from "node:perf_hooks";
import { Client } from "pg";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { readLimitedJson } from "@/lib/security/request-body";
import { isTrustedMutationRequest, mutationDeniedResponse } from "@/lib/security/request-origin";

export const runtime = "nodejs";

const connectionSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  database: z.string().trim().min(1).max(63),
  user: z.string().trim().min(1).max(63),
  password: z.string().max(1_024),
  ssl: z.boolean(),
}).strict();

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return mutationDeniedResponse();
  const actor = await getCurrentActor();
  if (!actor.tornUserId) return NextResponse.json({ error: "Connect a verified Torn API key before testing workspace storage." }, { status: 401 });
  if (!isPlatformOwner(actor)) return NextResponse.json({ error: "Only the platform owner can test a server-side database connection." }, { status: 403 });

  const input = await readLimitedJson(request, 4_096).catch(() => null);
  const parsed = connectionSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid PostgreSQL host, port, database, and username." }, { status: 400 });

  const client = new Client({
    ...parsed.data,
    application_name: "chainward-connection-test",
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
    ssl: parsed.data.ssl ? { rejectUnauthorized: false } : false,
  });
  const startedAt = performance.now();
  try {
    await client.connect();
    const result = await client.query<{ database: string; user: string; server_version: string }>("SELECT current_database() AS database, current_user AS user, current_setting('server_version') AS server_version");
    const row = result.rows[0];
    if (!row) throw new Error("PostgreSQL returned no server identity.");
    return NextResponse.json({ database: row.database, user: row.user, serverVersion: row.server_version, latencyMs: Math.max(1, Math.round(performance.now() - startedAt)) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: postgresErrorMessage(error) }, { status: 502, headers: { "cache-control": "no-store" } });
  } finally {
    await client.end().catch(() => undefined);
  }
}

function postgresErrorMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "28P01") return "PostgreSQL rejected the username or password.";
  if (code === "3D000") return "The requested PostgreSQL database does not exist.";
  if (code === "ECONNREFUSED") return "No PostgreSQL server accepted the connection at that host and port.";
  if (code === "ENOTFOUND") return "The PostgreSQL host name could not be resolved.";
  if (code === "ETIMEDOUT" || code === "CONNECT_TIMEOUT") return "The PostgreSQL connection timed out after 5 seconds.";
  return "The server could not verify this PostgreSQL connection. Check its credentials, SSL requirement, and network access.";
}
