import { AuthorizationError } from "@/lib/auth/authorization";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { consumePartitionRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";
import { refreshTargets } from "@/lib/targets/data-service";
import { enrichWithFairFight } from "@/lib/targets/ffscouter";
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

    const params = new URL(request.url).searchParams;
    const force = params.get("force") === "1";
    // A single poll fetches at most this many due targets, most-in-need first;
    // the client loops until `dueTotal` hits zero. Keeps a 300-target list from
    // firing hundreds of Torn calls in one request.
    const budgetParam = Number.parseInt(params.get("budget") ?? "", 10);
    const budget = Number.isFinite(budgetParam) ? Math.min(60, Math.max(1, budgetParam)) : 30;
    // `?ids=1,2,3` — force-refresh exactly these targets (the "Refresh all"
    // sweep walks the whole list in deterministic client-sized chunks).
    const ids = [...new Set((params.get("ids") ?? "").split(",").map((s) => Number.parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 60);
    const faction = { id: connection.factionId, name: connection.factionName ?? "", tag: connection.factionTag ?? "" };

    const [list, telemetry] = await Promise.all([
      readTargetList(faction.id, actor.tornUserId),
      getWorkspaceTelemetry(),
    ]);

    const scoped = ids.length > 0 ? list.entries.filter((entry) => ids.includes(entry.tornUserId)) : list.entries;
    const refresh = scoped.length > 0
      ? await refreshTargets(scoped, list.snapshots, ids.length > 0 ? { force: true } : { force, budget })
      : { snapshots: [], errors: {}, fetchedAt: new Date().toISOString(), source: "Torn API v2", disconnected: false, dueTotal: 0 };

    if (refresh.snapshots.length > 0) {
      await writeTargetList(faction, actor.tornUserId, mergeSnapshots(list, refresh.snapshots)).catch(() => undefined);
    }
    const ffTargets = (ids.length > 0 ? scoped : list.entries).map((entry) => entry.tornUserId);
    const ffMap = ffTargets.length > 0
      ? await enrichWithFairFight(faction.id, actor.tornUserId, ffTargets)
      : new Map();

    return Response.json({
      snapshots: refresh.snapshots,
      errors: refresh.errors,
      fetchedAt: refresh.fetchedAt,
      source: refresh.source,
      dueTotal: refresh.dueTotal,
      chain: telemetry.chain,
      dataAgeMs: telemetry.dataAgeMs ?? 0,
      checkedAt: telemetry.checkedAt,
      fairFight: Object.fromEntries([...ffMap].map(([tornUserId, info]) => [String(tornUserId), info])),
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
