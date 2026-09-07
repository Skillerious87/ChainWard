import { AuthorizationError } from "@/lib/auth/authorization";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { consumePartitionRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";
import { refreshTargets } from "@/lib/targets/data-service";
import { mergeSnapshots, readTargetList, targetsStorageAvailable, writeTargetList } from "@/lib/targets/store";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const dynamic = "force-dynamic";

/** Live poll for the Targets workspace: refreshes stale snapshots and returns
 *  the current chain reading. Kept lean — entry edits go through server actions. */
export async function GET(request: Request): Promise<Response> {
  const addressLimit = consumeRateLimit("targets-refresh:address", request, { limit: 40, windowMs: 60_000 });
  if (!addressLimit.allowed) return tooMany(addressLimit.retryAfterSeconds);

  try {
    const { actor } = await requireFactionPermission("faction:view");
    const actorLimit = consumePartitionRateLimit("targets-refresh:actor", actor.tornUserId, { limit: 30, windowMs: 60_000 });
    if (!actorLimit.allowed) return tooMany(actorLimit.retryAfterSeconds);

    const connection = await getConfiguredTornConnection();
    if (!connection) return Response.json({ error: "No Torn connection." }, { status: 409, headers: noStore });
    if (!targetsStorageAvailable()) return Response.json({ error: "Workspace storage is unavailable." }, { status: 409, headers: noStore });

    const force = new URL(request.url).searchParams.get("force") === "1";
    const faction = { id: connection.factionId, name: connection.factionName ?? "", tag: connection.factionTag ?? "" };

    const [list, telemetry] = await Promise.all([
      readTargetList(faction.id, actor.tornUserId),
      getWorkspaceTelemetry(),
    ]);

    const refresh = list.entries.length > 0
      ? await refreshTargets(list.entries, list.snapshots, force ? { force: true } : { maxAgeMs: 50_000 })
      : { snapshots: [], errors: {}, fetchedAt: new Date().toISOString(), source: "Torn API v2", disconnected: false };

    if (refresh.snapshots.length > 0) {
      await writeTargetList(faction, actor.tornUserId, mergeSnapshots(list, refresh.snapshots)).catch(() => undefined);
    }

    return Response.json({
      snapshots: refresh.snapshots,
      errors: refresh.errors,
      fetchedAt: refresh.fetchedAt,
      source: refresh.source,
      chain: telemetry.chain,
      dataAgeMs: telemetry.dataAgeMs ?? 0,
      checkedAt: telemetry.checkedAt,
    }, { headers: noStore });
  } catch (error) {
    const denied = error instanceof AuthorizationError;
    return Response.json(
      { error: error instanceof Error ? error.message : "The targets poll failed." },
      { status: denied ? 403 : 500, headers: noStore },
    );
  }
}

const noStore = { "cache-control": "no-store, max-age=0" } as const;

function tooMany(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "The targets watchlist is polling too frequently. Slow down." },
    { status: 429, headers: { ...noStore, "retry-after": String(retryAfterSeconds) } },
  );
}
