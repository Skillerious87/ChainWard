import "server-only";

import { apiState, apiStateStore } from "./api-state-store";
import { tornCredentialFingerprint } from "./api-pool-policy";
import { revokeApiPoolGrant } from "./api-pool-store";
import { TornClient } from "./client";
import { TornApiError } from "./errors";

interface IdentityProof {
  ownerId: number;
  factionId?: number | null;
  verifiedAt?: number;
}

export async function verifyTornIdentity(apiKey: string, ownerId: number, factionId: number, allowUnavailable = false): Promise<void> {
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
    if (error instanceof TornApiError && [1, 2, 7, 10, 13, 18].includes(error.code)) {
      const key = `credential:${fingerprint}`;
      await apiStateStore.transact([key], () => ({ result: undefined, changes: { [key]: apiState({ disabled: true, errorCode: error.code }) } }));
      await revokeApiPoolGrant(ownerId, factionId);
      throw error;
    }
    if (!allowUnavailable) throw error;
  }
}
