import "server-only";

import { cache } from "react";
import { apiState, apiStateStore } from "./api-state-store";
import { tornCredentialFingerprint } from "./api-pool-policy";
import { revokeApiPoolGrant } from "./api-pool-store";
import { TornClient } from "./client";
import { TornApiError } from "./errors";
import { currentTornRequestScope } from "./request-scope";

interface IdentityProof {
  ownerId: number;
  factionId?: number | null;
  verifiedAt?: number;
}

export async function verifyTornIdentity(apiKey: string, ownerId: number, factionId: number, allowUnavailable = false): Promise<void> {
  try {
    const scope = currentTornRequestScope();
    if (!scope) return await verifyIdentityForRender(apiKey, ownerId, factionId);
    const checks = scope.identityChecks ??= new Map();
    const key = `${tornCredentialFingerprint(apiKey)}:${ownerId}:${factionId}`;
    let check = checks.get(key);
    if (!check) {
      check = verifyIdentityForRender(apiKey, ownerId, factionId);
      checks.set(key, check);
    }
    await check;
  } catch (error) {
    // Display-only callers may tolerate outages; the pool must still reject
    // them. Both callers share the strict proof, never a tolerated failure.
    if (!allowUnavailable || isInvalidIdentity(error)) throw error;
  }
}

function isInvalidIdentity(error: unknown): error is TornApiError {
  return error instanceof TornApiError && [1, 2, 7, 10, 13, 18].includes(error.code);
}

// Share pending and completed proofs only within this render/request. Later
// requests still consult durable revocation state, including on cache hits.
const verifyIdentityForRender = cache(async (apiKey: string, ownerId: number, factionId: number): Promise<void> => {
  const fingerprint = tornCredentialFingerprint(apiKey);
  try {
    const [stored, credential] = await Promise.all([
      apiStateStore.read(`identity:${fingerprint}`),
      apiStateStore.read(`credential:${fingerprint}`) as Promise<{ disabled?: boolean; errorCode?: number } | undefined>,
    ]);
    if (credential?.disabled) throw new TornApiError(credential.errorCode ?? 18, "Your Torn connection needs revalidation.");
    const proof = stored as IdentityProof | undefined;
    if (proof?.ownerId === ownerId && typeof proof.verifiedAt === "number" && Date.now() - proof.verifiedAt < 60_000) {
      if (proof.factionId !== factionId) throw new TornApiError(7, "Your Torn connection no longer matches this faction.");
      return;
    }
    const client = new TornClient({ apiKey, coordinateRequests: true, coordination: { ownerId } });
    const identity = await client.getKeyInfo({ forceRefresh: true, bypassUpstreamCache: true });
    if (identity.info.user.id !== ownerId || identity.info.user.faction_id !== factionId) throw new TornApiError(7, "Your Torn connection no longer matches this faction.");
  } catch (error) {
    if (isInvalidIdentity(error)) {
      const key = `credential:${fingerprint}`;
      // Persistence failures must not replace a known identity refusal with
      // an outage that a display-only caller is permitted to tolerate.
      await Promise.allSettled([
        apiStateStore.transact([key], () => ({ result: undefined, changes: { [key]: apiState({ disabled: true, errorCode: error.code }) } })),
        revokeApiPoolGrant(ownerId, factionId),
      ]);
    }
    throw error;
  }
});
