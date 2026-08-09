import { NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { createLocalDatabase, localDatabaseExists, localDatabaseInfo } from "@/lib/data/local-database";

export const runtime = "nodejs";

export async function POST() {
  const actor = await getCurrentActor();
  if (!actor.tornUserId) return NextResponse.json({ error: "Connect a verified Torn API key before creating workspace storage." }, { status: 401 });
  if (!isPlatformOwner(actor)) return NextResponse.json({ error: "Only the platform owner can create a server-side local database." }, { status: 403 });
  if (process.env.DATABASE_URL?.trim()) return NextResponse.json({ error: "PostgreSQL is already configured. Disconnect it before selecting the local-file backend." }, { status: 409 });
  try {
    const created = !localDatabaseExists();
    const info = created ? createLocalDatabase() : localDatabaseInfo();
    return NextResponse.json({ created, provider: "sqlite", filename: info.filename, sizeBytes: info.sizeBytes }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The local database file could not be created. Check write access to the Chainward data folder." }, { status: 500 });
  }
}
