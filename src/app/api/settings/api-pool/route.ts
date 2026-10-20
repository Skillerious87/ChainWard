import { NextResponse } from "next/server";
import { z } from "zod";
import { readLimitedJson } from "@/lib/security/request-body";
import { isTrustedMutationRequest, mutationDeniedResponse } from "@/lib/security/request-origin";
import { consumePartitionRateLimit } from "@/lib/security/rate-limit";
import { mayUseFactionPool } from "@/lib/torn/api-pool-broker";
import { apiPoolStatus, decryptApiPoolGrant, revokeApiPoolGrant, saveApiPoolGrant, touchApiPoolPresence } from "@/lib/torn/api-pool-store";
import { apiStateStore } from "@/lib/torn/api-state-store";
import { readPoolGrant } from "@/lib/torn/api-request-budget";
import { API_POOL_POLICY_VERSION } from "@/lib/torn/api-pool-types";
import { TornClient } from "@/lib/torn/client";
import { currentConnectionScope } from "@/lib/torn/current-connection-scope";
import { TornApiError } from "@/lib/torn/errors";
import { isOfflineFixtureKey } from "@/lib/torn/offline-fixture";
import { verifyTornIdentity } from "@/lib/torn/api-identity";

const preferencesSchema = z.object({
  apiKey: z.string().trim().regex(/^[A-Za-z0-9]{16}$/).optional(),
  limitPerMinute: z.number().int().min(1).max(10),
  allowOffline: z.boolean(),
  allowBackground: z.boolean(),
  acceptContribution: z.literal(true),
  policyVersion: z.literal(API_POOL_POLICY_VERSION),
}).strict();

function json(body: unknown, status = 200, retryAfter?: number) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...(retryAfter ? { "retry-after": String(retryAfter) } : {}) } });
}

export async function GET() {
  const scope = await currentConnectionScope();
  if (!scope) return json({ error: "Connect to Torn before viewing your contribution." }, 401);
  if (isOfflineFixtureKey(scope.apiKey)) return json({ available: false, error: "API contributions are unavailable in the offline test workspace." });
  try {
    return json(await apiPoolStatus(scope.tornUserId, scope.tornFactionId));
  } catch {
    return json({ error: "Contribution storage is unavailable. Check that the current database schema has been applied." }, 503);
  }
}

export async function PUT(request: Request) {
  if (!isTrustedMutationRequest(request)) return mutationDeniedResponse();
  const scope = await currentConnectionScope();
  if (!scope) return json({ error: "Connect to Torn before contributing a key." }, 401);
  if (isOfflineFixtureKey(scope.apiKey)) return json({ error: "Offline fixture keys cannot join an API pool." }, 400);
  const limit = consumePartitionRateLimit("api-pool:settings", scope.tornUserId, { limit: 4, windowMs: 60_000 });
  if (!limit.allowed) return json({ error: "Wait before changing your contribution again." }, 429, limit.retryAfterSeconds);
  let parsed: z.infer<typeof preferencesSchema>;
  try {
    parsed = preferencesSchema.parse(await readLimitedJson(request, 2_048));
  } catch {
    return json({ error: "Check the key, contribution allowance and consent checkbox." }, 400);
  }
  if (parsed.allowBackground && !parsed.allowOffline) return json({ error: "Background monitoring also requires offline contribution permission." }, 400);
  if (!await mayUseFactionPool(scope.tornUserId, scope.tornFactionId)) return json({ error: "Active access to your faction workspace is required to contribute." }, 403);
  try {
    await verifyTornIdentity(scope.apiKey, scope.tornUserId, scope.tornFactionId);
    const existing = readPoolGrant(await apiStateStore.read(`grant:${scope.tornUserId}`));
    const apiKey = parsed.apiKey ?? (existing?.factionId === scope.tornFactionId && existing.encryptedKey ? decryptApiPoolGrant(existing) : null);
    if (!apiKey) return json({ error: "Enter a Public Only Torn API key belonging to your account." }, 400);
    const client = new TornClient({ apiKey, coordinateRequests: true, coordination: { ownerId: scope.tornUserId, validation: true } });
    const identity = await client.getKeyInfo({ forceRefresh: true, bypassUpstreamCache: true });
    if (identity.info.user.id !== scope.tornUserId || identity.info.user.faction_id !== scope.tornFactionId) return json({ error: "The contribution key must belong to your Torn account and current faction." }, 403);
    if (identity.info.access.type !== "Public Only") return json({ error: "Create a separate Public Only key for the pool. Limited, Full and Custom keys are not accepted as contributions." }, 400);
    await saveApiPoolGrant(scope.tornUserId, scope.tornFactionId, apiKey, { enabled: true, limitPerMinute: parsed.limitPerMinute, allowOffline: parsed.allowOffline, allowBackground: parsed.allowBackground }, apiStateStore, scope.keyFingerprint);
    await touchApiPoolPresence(scope.tornUserId, scope.tornFactionId);
    return json(await apiPoolStatus(scope.tornUserId, scope.tornFactionId));
  } catch (error) {
    if (error instanceof TornApiError) return json({ error: error.category === "RATE_LIMITED" ? "Your Torn API allowance is cooling down. Try again later." : "Torn could not verify this contribution key. Check that it is active and belongs to you." }, error.category === "RATE_LIMITED" ? 429 : 400, error.retryAfterSeconds);
    return json({ error: "The contribution could not be saved securely. Check the database schema and try again." }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!isTrustedMutationRequest(request)) return mutationDeniedResponse();
  const scope = await currentConnectionScope();
  if (!scope) return json({ error: "Connect to Torn before removing your contribution." }, 401);
  try {
    await revokeApiPoolGrant(scope.tornUserId);
    return json(await apiPoolStatus(scope.tornUserId, scope.tornFactionId));
  } catch {
    return json({ error: "Contribution storage is unavailable. You can also pause or delete the contribution key in Torn Settings." }, 503);
  }
}
