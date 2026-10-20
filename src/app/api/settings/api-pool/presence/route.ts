import { NextResponse } from "next/server";
import { isTrustedMutationRequest, mutationDeniedResponse } from "@/lib/security/request-origin";
import { consumePartitionRateLimit } from "@/lib/security/rate-limit";
import { mayUseFactionPool } from "@/lib/torn/api-pool-broker";
import { touchApiPoolPresence } from "@/lib/torn/api-pool-store";
import { currentConnectionScope } from "@/lib/torn/current-connection-scope";
import { isOfflineFixtureKey } from "@/lib/torn/offline-fixture";
import { apiStateStore } from "@/lib/torn/api-state-store";
import { readPoolGrant } from "@/lib/torn/api-request-budget";

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return mutationDeniedResponse();
  const scope = await currentConnectionScope();
  if (!scope || isOfflineFixtureKey(scope.apiKey)) return new NextResponse(null, { status: 204 });
  const limit = consumePartitionRateLimit("api-pool:presence", scope.tornUserId, { limit: 12, windowMs: 60_000 });
  if (!limit.allowed) return new NextResponse(null, { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds), "cache-control": "no-store" } });
  try {
    const grant = readPoolGrant(await apiStateStore.read(`grant:${scope.tornUserId}`));
    if (!grant?.enabled || grant.factionId !== scope.tornFactionId) return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
    if (!await mayUseFactionPool(scope.tornUserId, scope.tornFactionId)) return new NextResponse(null, { status: 403 });
    await touchApiPoolPresence(scope.tornUserId, scope.tornFactionId);
    return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch {
    return new NextResponse(null, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
