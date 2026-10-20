import "server-only";

import { apiState, apiStateStore, type ApiStateStore, type ApiStateWrite } from "./api-state-store";
import { API_POOL_POLICY_VERSION, TORN_PLAYER_REQUEST_LIMIT, type ApiPoolGrant, type TornCoordinationContext } from "./api-pool-types";
import { TornApiError } from "./errors";

interface RequestBudget {
  attempts: Array<{ at: number; contribution: boolean }>;
  blockedUntil: number;
}

export function readRequestBudget(value: unknown, now = Date.now()): RequestBudget {
  const budget = value as Partial<RequestBudget> | undefined;
  return {
    attempts: Array.isArray(budget?.attempts) ? budget.attempts.filter((attempt) => attempt.at > now - 60_000) : [],
    blockedUntil: typeof budget?.blockedUntil === "number" ? budget.blockedUntil : 0,
  };
}

export function readPoolGrant(value: unknown): ApiPoolGrant | null {
  if (!value || typeof value !== "object") return null;
  const grant = value as ApiPoolGrant;
  return grant.policyVersion === API_POOL_POLICY_VERSION && typeof grant.ownerId === "number" && typeof grant.factionId === "number" && typeof grant.version === "string" ? grant : null;
}

export async function reserveTornAttempt(fingerprint: string, context: TornCoordinationContext, store: ApiStateStore = apiStateStore): Promise<void> {
  const identity = await store.read(`identity:${fingerprint}`) as { ownerId?: number } | undefined;
  const ownerId = context.ownerId ?? identity?.ownerId;
  if (context.ownerId && identity?.ownerId && context.ownerId !== identity.ownerId) throw new TornApiError(2, "The Torn credential identity changed.");
  const budgetKey = ownerId ? `budget:${ownerId}` : `bootstrap:${fingerprint}`;
  const grantKey = `grant:${context.contribution?.ownerId ?? 0}`;
  const presenceKey = `presence:${context.contribution?.ownerId ?? 0}`;
  const credentialKey = `credential:${fingerprint}`;
  await store.transact([budgetKey, "egress", credentialKey, ...(context.contribution ? [grantKey, presenceKey] : [])], (values) => {
    const now = Date.now();
    const budget = readRequestBudget(values[budgetKey], now);
    const egress = readRequestBudget(values.egress, now);
    const credential = values[credentialKey] as { disabled?: boolean; errorCode?: number } | undefined;
    if (credential?.disabled && !context.validation) throw new TornApiError(credential.errorCode ?? 18, "This Torn credential needs revalidation.");
    const blockedUntil = Math.max(budget.blockedUntil, egress.blockedUntil);
    if (blockedUntil > now) throw new TornApiError(5, "Torn API calls are cooling down.", { retryAfterSeconds: Math.ceil((blockedUntil - now) / 1_000) });
    if (budget.attempts.length >= (ownerId ? TORN_PLAYER_REQUEST_LIMIT : 4) || egress.attempts.length >= 240) {
      throw new TornApiError(5, "The conservative Chainward request allowance has been used.", { retryAfterSeconds: 60 });
    }
    const changes: Record<string, ApiStateWrite> = {};
    if (context.contribution) {
      const grant = readPoolGrant(values[grantKey]);
      const presence = values[presenceKey] as { factionId?: number; until?: number } | undefined;
      if (!grant?.enabled || grant.version !== context.contribution.version || grant.factionId !== context.contribution.factionId || grant.ownerId !== ownerId || grant.fingerprint !== fingerprint) {
        throw new TornApiError(18, "This API contribution is no longer authorised.");
      }
      if ((!grant.allowOffline && (presence?.factionId !== grant.factionId || (presence?.until ?? 0) <= now)) || (context.contribution.background && !grant.allowBackground)) {
        throw new TornApiError(18, "This contribution does not permit the requested background or offline use.");
      }
      if (!context.verificationRequest && now - grant.verifiedAt >= 60_000) throw new TornApiError(18, "This contribution needs fresh membership verification.");
      if (budget.attempts.filter((attempt) => attempt.contribution).length >= grant.limitPerMinute) throw new TornApiError(5, "The contribution allowance has been used.", { retryAfterSeconds: 60 });
      changes[grantKey] = apiState({ ...grant, lastUsedAt: new Date(now).toISOString() });
    }
    const attempt = { at: now, contribution: Boolean(context.contribution) };
    changes[budgetKey] = apiState({ ...budget, attempts: [...budget.attempts, attempt] }, Math.max(now + 60_000, budget.blockedUntil + 60_000));
    changes.egress = apiState({ ...egress, attempts: [...egress.attempts, attempt] }, Math.max(now + 60_000, egress.blockedUntil + 60_000));
    return { result: undefined, changes };
  });
}

export async function identifyTornOwner(fingerprint: string, ownerId: number, store: ApiStateStore = apiStateStore, proof?: { factionId: number | null; verifiedAt: number }): Promise<void> {
  const identityKey = `identity:${fingerprint}`;
  const bootstrapKey = `bootstrap:${fingerprint}`;
  const budgetKey = `budget:${ownerId}`;
  const credentialKey = `credential:${fingerprint}`;
  await store.transact([identityKey, bootstrapKey, budgetKey, credentialKey], (values) => {
    const now = Date.now();
    const budget = readRequestBudget(values[budgetKey], now);
    const bootstrap = readRequestBudget(values[bootstrapKey], now);
    return { result: undefined, changes: {
      [identityKey]: apiState({ ownerId, ...proof }, now + 86_400_000),
      [bootstrapKey]: apiState({ attempts: [], blockedUntil: 0 }, now + 60_000),
      [budgetKey]: apiState({ ...budget, attempts: [...budget.attempts, ...bootstrap.attempts] }, Math.max(now + 60_000, budget.blockedUntil + 60_000)),
      [credentialKey]: apiState({ disabled: false }, now + 86_400_000),
    } };
  });
}

export async function recordTornFailure(fingerprint: string, context: TornCoordinationContext, error: TornApiError, store: ApiStateStore = apiStateStore): Promise<void> {
  const identity = await store.read(`identity:${fingerprint}`) as { ownerId?: number } | undefined;
  const ownerId = context.ownerId ?? identity?.ownerId;
  const budgetKey = ownerId ? `budget:${ownerId}` : `bootstrap:${fingerprint}`;
  const credentialKey = `credential:${fingerprint}`;
  const grantKey = `grant:${context.contribution?.ownerId ?? 0}`;
  await store.transact([budgetKey, credentialKey, "egress", grantKey], (values) => {
    const now = Date.now();
    const changes: Record<string, ApiStateWrite> = {};
    const disabled = [1, 2, 10, 13, 18].includes(error.code);
    if (disabled) changes[credentialKey] = apiState({ disabled: true, errorCode: error.code });
    if ([5, 14].includes(error.code)) {
      const budget = readRequestBudget(values[budgetKey], now);
      const delay = error.code === 14 ? 86_400_000 - now % 86_400_000 : 60_000;
      const blockedUntil = Math.max(budget.blockedUntil, now + Math.max(delay, (error.retryAfterSeconds ?? 0) * 1_000));
      changes[budgetKey] = apiState({ ...budget, blockedUntil }, Math.max(now + 2 * 86_400_000, blockedUntil + 60_000));
    }
    if ([8, 9, 17, 24].includes(error.code)) {
      const egress = readRequestBudget(values.egress, now);
      const blockedUntil = Math.max(egress.blockedUntil, now + Math.max(error.code === 8 ? 300_000 : 5_000, (error.retryAfterSeconds ?? 0) * 1_000));
      changes.egress = apiState({ ...egress, blockedUntil }, Math.max(now + 2 * 86_400_000, blockedUntil + 60_000));
    }
    const grant = readPoolGrant(values[grantKey]);
    if (grant && grant.version === context.contribution?.version) {
      changes[grantKey] = apiState({ ...grant, enabled: disabled || [7, 16].includes(error.code) ? false : grant.enabled, lastError: `Torn error ${error.code}. Revalidate or replace the contribution key if this persists.` });
    }
    return { result: undefined, changes };
  });
}
