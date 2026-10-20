import "server-only";

import { randomUUID } from "node:crypto";
import { encryptCredential, decryptCredential } from "@/lib/security/credential-encryption";
import { credentialEncryptionSecret } from "@/lib/security/credential-secret";
import { apiState, apiStateStore, type ApiStateStore } from "./api-state-store";
import { API_POOL_MAX_CONTRIBUTION, API_POOL_POLICY_VERSION, API_POOL_PRESENCE_MS, type ApiPoolGrant, type ApiPoolPreferences, type ApiPoolStatus } from "./api-pool-types";
import { readPoolGrant, readRequestBudget } from "./api-request-budget";
import { tornCredentialFingerprint } from "./api-pool-policy";

export async function saveApiPoolGrant(ownerId: number, factionId: number, apiKey: string, preferences: ApiPoolPreferences, store: ApiStateStore = apiStateStore, connectionFingerprint?: string): Promise<void> {
  if (!Number.isInteger(preferences.limitPerMinute) || preferences.limitPerMinute < 1 || preferences.limitPerMinute > API_POOL_MAX_CONTRIBUTION) throw new Error("Choose a contribution allowance between 1 and 10 requests per minute.");
  if (preferences.allowBackground && !preferences.allowOffline) throw new Error("Background alerts require permission to contribute while offline.");
  const now = Date.now();
  const consent = {
    ownerId,
    factionId,
    version: randomUUID(),
    policyVersion: API_POOL_POLICY_VERSION,
    limitPerMinute: preferences.limitPerMinute,
    allowOffline: preferences.allowOffline,
    allowBackground: preferences.allowBackground,
    acceptedAt: new Date(now).toISOString(),
    connectionFingerprint,
  };
  const encrypted = encryptCredential(JSON.stringify({ ...consent, apiKey }), credentialEncryptionSecret());
  const grant: ApiPoolGrant = {
    ...preferences,
    ...consent,
    encryptedKey: encrypted.encryptedKey.toString("base64"),
    encryptionIv: encrypted.encryptionIv.toString("base64"),
    fingerprint: tornCredentialFingerprint(apiKey),
    lastFour: apiKey.slice(-4),
    verifiedAt: now,
    lastUsedAt: null,
    lastError: null,
    ...(connectionFingerprint ? { connectionFingerprint } : {}),
  };
  const grantKey = `grant:${ownerId}`;
  await store.transact([grantKey], () => ({ result: undefined, changes: { [grantKey]: apiState(grant) } }));
}

export async function reconcileApiPoolConnection(ownerId: number, factionId: number, connectionFingerprint: string): Promise<void> {
  const key = `grant:${ownerId}`;
  await apiStateStore.transact([key], (values) => {
    const grant = readPoolGrant(values[key]);
    if (!grant?.enabled || (grant.factionId === factionId && grant.connectionFingerprint === connectionFingerprint)) return { result: undefined, changes: {} };
    return { result: undefined, changes: { [key]: apiState({ policyVersion: API_POOL_POLICY_VERSION, version: randomUUID(), ownerId, factionId: grant.factionId, enabled: false, revokedAt: new Date().toISOString() }) } };
  });
}

export function decryptApiPoolGrant(grant: ApiPoolGrant): string {
  const plaintext = decryptCredential(Buffer.from(grant.encryptedKey, "base64"), Buffer.from(grant.encryptionIv, "base64"), credentialEncryptionSecret());
  const payload = JSON.parse(plaintext) as Record<string, unknown>;
  for (const field of ["ownerId", "factionId", "version", "policyVersion", "limitPerMinute", "allowOffline", "allowBackground", "acceptedAt", "connectionFingerprint"] as const) {
    if (payload[field] !== grant[field]) throw new Error("The encrypted API contribution does not match its consent context.");
  }
  if (typeof payload.apiKey !== "string" || !/^[A-Za-z0-9]{16}$/.test(payload.apiKey) || tornCredentialFingerprint(payload.apiKey) !== grant.fingerprint) throw new Error("The encrypted API contribution is invalid.");
  return payload.apiKey;
}

export async function revokeApiPoolGrant(ownerId: number, factionId?: number, store: ApiStateStore = apiStateStore): Promise<void> {
  const key = `grant:${ownerId}`;
  await store.transact([key], (values) => {
    const grant = readPoolGrant(values[key]);
    if (!grant?.encryptedKey || (factionId && grant.factionId !== factionId)) return { result: undefined, changes: {} };
    return { result: undefined, changes: { [key]: apiState({ policyVersion: API_POOL_POLICY_VERSION, version: randomUUID(), ownerId, factionId: grant.factionId, enabled: false, revokedAt: new Date().toISOString() }) } };
  });
}

export async function touchApiPoolPresence(ownerId: number, factionId: number, store: ApiStateStore = apiStateStore): Promise<void> {
  const key = `presence:${ownerId}`;
  const now = Date.now();
  await store.transact([key], (values) => {
    const current = values[key] as { factionId?: number; until?: number } | undefined;
    if (current?.factionId === factionId && (current.until ?? 0) > now + API_POOL_PRESENCE_MS - 10_000) return { result: undefined, changes: {} };
    return { result: undefined, changes: { [key]: apiState({ factionId, until: now + API_POOL_PRESENCE_MS }, now + API_POOL_PRESENCE_MS) } };
  });
}

export async function apiPoolStatus(ownerId: number, factionId: number, store: ApiStateStore = apiStateStore): Promise<ApiPoolStatus> {
  const [stored, usage] = await Promise.all([store.read(`grant:${ownerId}`), store.read(`budget:${ownerId}`)]);
  const grant = readPoolGrant(stored);
  const applicable = grant?.factionId === factionId && typeof grant.encryptedKey === "string" ? grant : null;
  const budget = readRequestBudget(usage);
  return {
    available: true,
    enabled: applicable?.enabled ?? false,
    limitPerMinute: applicable?.limitPerMinute ?? API_POOL_MAX_CONTRIBUTION,
    allowOffline: applicable?.allowOffline ?? false,
    allowBackground: applicable?.allowBackground ?? false,
    lastFour: applicable?.lastFour ?? null,
    acceptedAt: applicable?.acceptedAt ?? null,
    requestsLastMinute: budget.attempts.length,
    contributionsLastMinute: budget.attempts.filter((attempt) => attempt.contribution).length,
    lastUsedAt: applicable?.lastUsedAt ?? null,
    lastError: applicable?.lastError ?? null,
  };
}
