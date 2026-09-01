import { NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { isTrustedMutationRequest, mutationDeniedResponse } from "@/lib/security/request-origin";
import { createLocalDatabase, localDatabaseExists, localDatabaseInfo } from "@/lib/data/local-database";
import { acquireConcurrencySlot, consumePartitionRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return mutationDeniedResponse();
  const requestLimit = consumeRateLimit("local-database-create:address", request, { limit: 8, windowMs: 10 * 60_000 });
  if (!requestLimit.allowed) return NextResponse.json({ error: "Too many database creation requests. Wait before trying again." }, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(requestLimit.retryAfterSeconds) } });
  const actor = await getCurrentActor();
  if (!actor.tornUserId) return NextResponse.json({ error: "Connect a verified Torn API key before creating workspace storage." }, { status: 401 });
  if (!isPlatformOwner(actor)) return NextResponse.json({ error: "Only the platform owner can create a server-side local database." }, { status: 403 });
  const actorLimit = consumePartitionRateLimit("local-database-create:actor", actor.tornUserId, { limit: 4, windowMs: 10 * 60_000 });
  if (!actorLimit.allowed) return NextResponse.json({ error: "Too many database creation requests. Wait before trying again." }, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(actorLimit.retryAfterSeconds) } });
  if (process.env.DATABASE_URL?.trim()) return NextResponse.json({ error: "PostgreSQL is already configured. Disconnect it before selecting the local-file backend." }, { status: 409 });
  const releaseSlot = acquireConcurrencySlot("local-database-create:process", "global", 1);
  if (!releaseSlot) return NextResponse.json({ error: "The local database is already being prepared." }, { status: 429, headers: { "cache-control": "no-store", "retry-after": "1" } });
  try {
    const created = !localDatabaseExists();
    const info = created ? createLocalDatabase() : localDatabaseInfo();
    return NextResponse.json({ created, provider: "sqlite", filename: info.filename, sizeBytes: info.sizeBytes }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The local database file could not be created. Check write access to the Chainward data folder." }, { status: 500 });
  } finally {
    releaseSlot();
  }
}
