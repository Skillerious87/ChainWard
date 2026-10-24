import { AuthorizationError } from "@/lib/auth/authorization";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { consumePartitionRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";
import { getBestChainTarget } from "@/lib/targets/best-target";
import { withTornRequestScope } from "@/lib/torn/request-scope";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store, max-age=0" } as const;

export async function GET(request: Request): Promise<Response> {
  return withTornRequestScope(() => getNextTarget(request));
}

async function getNextTarget(request: Request): Promise<Response> {
  const addressLimit = consumeRateLimit("next-target:address", request, { limit: 30, windowMs: 60_000 });
  if (!addressLimit.allowed) return tooMany(addressLimit.retryAfterSeconds);
  try {
    const { actor } = await requireFactionPermission("faction:view");
    const actorLimit = consumePartitionRateLimit("next-target:actor", actor.tornUserId, { limit: 20, windowMs: 60_000 });
    if (!actorLimit.allowed) return tooMany(actorLimit.retryAfterSeconds);
    return Response.json(await getBestChainTarget(), { headers: noStore });
  } catch (error) {
    return Response.json({ error: "The next target could not be checked." }, {
      status: error instanceof AuthorizationError ? 403 : 500,
      headers: noStore,
    });
  }
}

function tooMany(retryAfterSeconds: number): Response {
  return Response.json({ error: "Target checks are temporarily limited." }, {
    status: 429,
    headers: { ...noStore, "retry-after": String(retryAfterSeconds) },
  });
}
