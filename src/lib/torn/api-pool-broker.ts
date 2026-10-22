import "server-only";

import { randomUUID } from "node:crypto";
import { cache } from "react";
import { getFactionAccessAssignment } from "@/lib/auth/faction-access-store";
import { PLATFORM_OWNER } from "@/lib/auth/platform-owner";
import { getFactionAccessSummary } from "@/lib/licensing/faction-access";
import { apiState, apiStateStore, type ApiStateStore } from "./api-state-store";
import { TornClient } from "./client";
import { TornApiError } from "./errors";
import { canonicalFactionPoolRequest, factionPoolCacheKey, factionPoolOperation, projectFactionPoolResponse } from "./api-pool-policy";
import { decryptApiPoolGrant, revokeApiPoolGrant } from "./api-pool-store";
import { readPoolGrant, readRequestBudget } from "./api-request-budget";
import type { ApiPoolGrant, FactionPoolRequest, TornResponseSnapshot } from "./api-pool-types";
import { factionMembersResponseSchema } from "./schemas";
import { verifyTornIdentity } from "./api-identity";

interface FactionPoolContext {
  factionId: number;
  ownerId?: number;
  background?: boolean;
  apiKey?: string;
}

interface SharedSnapshot extends TornResponseSnapshot {
  expiresAt: number;
}

interface SharedOperationState {
  snapshot?: SharedSnapshot;
  lease?: { token: string; until: number };
  retryAt?: number;
}

export const mayUseFactionPool = cache(async (ownerId: number, factionId: number): Promise<boolean> => {
  const [access, assignment] = await Promise.all([getFactionAccessSummary(factionId), ownerId === PLATFORM_OWNER.tornUserId ? Promise.resolve(null) : getFactionAccessAssignment(factionId, ownerId)]);
  return access.state === "active" && (ownerId === PLATFORM_OWNER.tornUserId || assignment?.status === "ACTIVE");
});

export async function readSharedOperation(
  factionId: number,
  input: FactionPoolRequest,
  refresh: (request: FactionPoolRequest) => Promise<TornResponseSnapshot>,
  store: ApiStateStore = apiStateStore,
): Promise<TornResponseSnapshot> {
  const request = canonicalFactionPoolRequest(input, factionId);
  const key = factionPoolCacheKey(request, factionId);
  const existing = await store.read(key) as SharedOperationState | undefined;
  const minimumAge = factionPoolOperation(request.path, factionId) === "chain" ? 5_000 : 15_000;
  const existingSnapshot = existing?.snapshot;
  if (existingSnapshot && Math.min(existingSnapshot.expiresAt, existingSnapshot.fetchedAt + request.cacheMs) > Date.now() && (!request.forceRefresh || Date.now() - existingSnapshot.fetchedAt < minimumAge)) {
    return { value: projectFactionPoolResponse(request, factionId, existingSnapshot.value), fetchedAt: existingSnapshot.fetchedAt };
  }
  const token = randomUUID();
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const claim = await store.transact<{ snapshot?: SharedSnapshot; claimed: boolean }>([key], (values) => {
      const current = values[key] as SharedOperationState | undefined;
      const now = Date.now();
      const snapshot = current?.snapshot;
      if (current?.retryAt && current.retryAt > now) throw new TornApiError(17, "The shared Torn refresh is cooling down.", { retryAfterSeconds: Math.ceil((current.retryAt - now) / 1_000) });
      if (snapshot && Math.min(snapshot.expiresAt, snapshot.fetchedAt + request.cacheMs) > now && (!request.forceRefresh || now - snapshot.fetchedAt < minimumAge)) return { result: { snapshot, claimed: false }, changes: {} };
      if (current?.lease && current.lease.until > now) return { result: { snapshot: undefined, claimed: false }, changes: {} };
      return { result: { snapshot: undefined, claimed: true }, changes: { [key]: apiState({ ...current, lease: { token, until: now + 15_000 } }, now + 86_400_000) } };
    });
    if (claim.snapshot) return { value: projectFactionPoolResponse(request, factionId, claim.snapshot.value), fetchedAt: claim.snapshot.fetchedAt };
    if (!claim.claimed) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      continue;
    }
    try {
      const loaded = await refresh(request);
      const value = projectFactionPoolResponse(request, factionId, loaded.value);
      const snapshot = { value, fetchedAt: loaded.fetchedAt, expiresAt: loaded.fetchedAt + request.cacheMs };
      const committed = await store.transact([key], (values) => {
        const current = values[key] as SharedOperationState | undefined;
        if (current?.lease?.token !== token || current.lease.until <= Date.now()) return { result: false, changes: {} };
        return { result: true, changes: { [key]: apiState({ snapshot }, snapshot.expiresAt + 60_000) } };
      });
      if (!committed) throw new TornApiError(17, "The shared Torn refresh lease expired. Try again.");
      return { value, fetchedAt: loaded.fetchedAt };
    } catch (error) {
      await store.transact([key], (values) => {
        const current = values[key] as SharedOperationState | undefined;
        if (current?.lease?.token !== token) return { result: undefined, changes: {} };
        return { result: undefined, changes: { [key]: apiState({ snapshot: current.snapshot ?? null, retryAt: Date.now() + 5_000 }, Date.now() + 60_000) } };
      });
      throw error;
    }
  }
  throw new TornApiError(17, "A shared Torn refresh is still in progress.", { retryAfterSeconds: 5 });
}

function directClient(apiKey: string, ownerId: number, grant?: ApiPoolGrant, background = false): TornClient {
  return new TornClient({
    apiKey,
    coordinateRequests: true,
    coordination: {
      ownerId,
      ...(grant ? { contribution: { ownerId, factionId: grant.factionId, version: grant.version, background } } : {}),
    },
    requestTimeoutMs: 10_000,
  });
}

async function executeOperation(client: TornClient, request: FactionPoolRequest, factionId: number): Promise<TornResponseSnapshot> {
  const operation = factionPoolOperation(request.path, factionId);
  const options = { forceRefresh: true, bypassUpstreamCache: operation === "chain" };
  let value: unknown;
  if (operation === "chain") {
    value = await client.getCurrentChain(factionId, options);
    return { value, fetchedAt: client.getCurrentChainFetchedAt() ?? Date.now() };
  }
  if (operation === "basic") value = await client.getFactionBasic(factionId, options);
  else if (operation === "members") value = await client.getFactionMembers(factionId, options);
  else if (operation === "chains") value = await client.getCompletedChains(factionId, {
    ...(request.query.from ? { from: Number(request.query.from) } : {}),
    ...(request.query.to ? { to: Number(request.query.to) } : {}),
    ...(request.query.limit ? { limit: Number(request.query.limit) } : {}),
  }, options);
  else if (operation === "chainreport") value = await client.getChainReport(Number(request.path.match(/^\/faction\/(\d+)\/chainreport$/)?.[1]) || undefined, options);
  else throw new Error("This Torn operation cannot use shared capacity.");
  return { value, fetchedAt: Date.now() };
}

async function refreshWithContributor(context: FactionPoolContext, request: FactionPoolRequest): Promise<TornResponseSnapshot> {
  const now = Date.now();
  const entries = await apiStateStore.list("grant:");
  const eligible = (await Promise.all(entries.map(async (entry) => {
    const grant = readPoolGrant(entry.value);
    if (!grant?.enabled || grant.factionId !== context.factionId || (context.background && !grant.allowBackground)) return null;
    const [presenceValue, budgetValue] = await Promise.all([apiStateStore.read(`presence:${grant.ownerId}`), apiStateStore.read(`budget:${grant.ownerId}`)]);
    const presence = presenceValue as { factionId?: number; until?: number } | undefined;
    if (!grant.allowOffline && (presence?.factionId !== grant.factionId || (presence?.until ?? 0) <= now)) return null;
    const budget = readRequestBudget(budgetValue, now);
    const usage = budget.attempts.filter((attempt) => attempt.contribution).length;
    if (usage >= grant.limitPerMinute || budget.attempts.length >= 30 || budget.blockedUntil > now) return null;
    return { grant, usage: usage / grant.limitPerMinute };
  }))).filter((candidate): candidate is { grant: ApiPoolGrant; usage: number } => candidate !== null);
  eligible.sort((left, right) => left.usage - right.usage || (left.grant.lastUsedAt ?? "").localeCompare(right.grant.lastUsedAt ?? ""));
  const candidate = eligible[0]?.grant;
  if (candidate) {
    let apiKey: string;
    try {
      apiKey = decryptApiPoolGrant(candidate);
    } catch {
      const key = `grant:${candidate.ownerId}`;
      await apiStateStore.transact([key], (values) => {
        const current = readPoolGrant(values[key]);
        return { result: undefined, changes: current?.version === candidate.version ? { [key]: apiState({ ...current, enabled: false, lastError: "This contribution could not be decrypted securely. Add your Public Only key again." }) } : {} };
      });
      if (context.apiKey && context.ownerId && !context.background) return executeOperation(directClient(context.apiKey, context.ownerId), request, context.factionId);
      throw new TornApiError(18, "No usable background contribution is available.");
    }
    const client = directClient(apiKey, candidate.ownerId, candidate, context.background);
    if (now - candidate.verifiedAt >= 60_000) {
      const identity = await client.getKeyInfo({ forceRefresh: true, bypassUpstreamCache: true });
      if (identity.info.user.id !== candidate.ownerId || identity.info.user.faction_id !== candidate.factionId || identity.info.access.type !== "Public Only") {
        await revokeApiPoolGrant(candidate.ownerId, candidate.factionId);
        throw new TornApiError(7, "The contribution key no longer matches its owner and faction.");
      }
      const key = `grant:${candidate.ownerId}`;
      await apiStateStore.transact([key], (values) => {
        const current = readPoolGrant(values[key]);
        return { result: undefined, changes: current?.enabled && current.version === candidate.version ? { [key]: apiState({ ...current, verifiedAt: Date.now(), lastError: null }) } : {} };
      });
    }
    const snapshot = await executeOperation(client, request, context.factionId);
    if (factionPoolOperation(request.path, context.factionId) === "members") {
      const members = new Set(factionMembersResponseSchema.parse(snapshot.value).members.map((member) => member.id));
      for (const entry of entries) {
        const grant = readPoolGrant(entry.value);
        if (grant?.enabled && grant.factionId === context.factionId && !members.has(grant.ownerId)) await revokeApiPoolGrant(grant.ownerId, grant.factionId);
      }
    }
    return snapshot;
  }
  if (!context.apiKey || !context.ownerId || context.background) throw new TornApiError(18, "No authorised API contributor is currently available for this faction.");
  return executeOperation(directClient(context.apiKey, context.ownerId), request, context.factionId);
}

/** Request-scoped only: each viewer is still rechecked on the next request. */
const readViewerFactionRoster = cache(async (ownerId: number, factionId: number, apiKey: string, background: boolean): Promise<TornResponseSnapshot> => {
  await verifyTornIdentity(apiKey, ownerId, factionId);
  const context = { ownerId, factionId, apiKey, background };
  const rosterRequest = { path: `/faction/${factionId}/members`, query: {}, cacheMs: 30_000, forceRefresh: false };
  const roster = await readSharedOperation(factionId, rosterRequest, (operation) => refreshWithContributor(context, operation));
  const members = factionMembersResponseSchema.parse(roster.value).members;
  if (!members.some((member) => member.id === ownerId)) {
    await revokeApiPoolGrant(ownerId, factionId);
    throw new TornApiError(7, "You are no longer in this faction's current roster.");
  }
  return roster;
});

export async function readFactionPoolRequest(context: FactionPoolContext, request: FactionPoolRequest, ownRead?: () => Promise<TornResponseSnapshot>): Promise<TornResponseSnapshot> {
  if (!context.ownerId && !context.background) throw new TornApiError(7, "A verified player session is required for shared faction data.");
  if (context.ownerId && !await mayUseFactionPool(context.ownerId, context.factionId)) {
    if (ownRead) return ownRead();
    throw new TornApiError(7, "Faction access is required for shared data.");
  }
  if (context.background && (await getFactionAccessSummary(context.factionId)).state !== "active") throw new TornApiError(7, "Active faction access is required for background monitoring.");
  if (context.ownerId && !context.apiKey) throw new TornApiError(2, "The viewer's own Torn key is required to verify access.");
  const rosterRequest = { path: `/faction/${context.factionId}/members`, query: {}, cacheMs: 30_000, forceRefresh: false };
  const roster = context.ownerId
    ? await readViewerFactionRoster(context.ownerId, context.factionId, context.apiKey!, context.background === true)
    : await readSharedOperation(context.factionId, rosterRequest, (operation) => refreshWithContributor(context, operation));
  if (factionPoolOperation(request.path, context.factionId) === "members") return roster;
  return readSharedOperation(context.factionId, request, (operation) => refreshWithContributor(context, operation));
}

export function backgroundFactionPoolClient(factionId: number) {
  return {
    async getCurrentChain() {
      const snapshot = await readFactionPoolRequest({ factionId, background: true }, { path: `/faction/${factionId}/chain`, query: {}, cacheMs: 5_000, forceRefresh: true });
      return snapshot.value as Awaited<ReturnType<TornClient["getCurrentChain"]>>;
    },
    async getFactionMembers() {
      const snapshot = await readFactionPoolRequest({ factionId, background: true }, { path: `/faction/${factionId}/members`, query: {}, cacheMs: 30_000, forceRefresh: false });
      return factionMembersResponseSchema.parse(snapshot.value);
    },
  };
}
