import type { WorkspaceTelemetry } from "./telemetry-types";

export interface TelemetryRequestResult {
  ok: boolean;
  payload: unknown;
  transitMs: number;
}

// Strict Mode remounts effects in development, and multiple controls can ask
// for the same refresh while the scheduler is already waiting. Share the
// parsed response so those callers issue one request and consume one body.
const pendingTelemetryRequests = new Map<string, Promise<TelemetryRequestResult>>();

export function requestWorkspaceTelemetry(endpoint: string): Promise<TelemetryRequestResult> {
  const pending = pendingTelemetryRequests.get(endpoint);
  if (pending) return pending;
  const startedAt = performance.now();
  const request: Promise<TelemetryRequestResult> = fetch(endpoint, {
    headers: { accept: "application/json" },
    cache: "no-store",
    // Release the shared request after a stalled connection so later polls
    // and manual refreshes can recover without reloading the application.
    signal: AbortSignal.timeout(15_000),
  }).then(async (response) => ({
    ok: response.ok,
    payload: await response.json() as unknown,
    transitMs: Math.max(0, (performance.now() - startedAt) / 2),
  })).finally(() => {
    if (pendingTelemetryRequests.get(endpoint) === request) pendingTelemetryRequests.delete(endpoint);
  });
  pendingTelemetryRequests.set(endpoint, request);
  return request;
}

export function isWorkspaceTelemetry(value: unknown): value is WorkspaceTelemetry {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<WorkspaceTelemetry>;
  return (candidate.source === "live" || candidate.source === "unavailable")
    && typeof candidate.checkedAt === "string"
    && Number.isFinite(Date.parse(candidate.checkedAt))
    && typeof candidate.message === "string"
    && (candidate.mode === undefined || candidate.mode === "torn" || candidate.mode === "offline")
    && (candidate.dataAgeMs === undefined || isNonNegativeNumber(candidate.dataAgeMs))
    && (candidate.faction === null || (isRecord(candidate.faction)
      && Number.isSafeInteger(candidate.faction.id) && candidate.faction.id > 0
      && typeof candidate.faction.name === "string" && typeof candidate.faction.tag === "string"
      && Number.isSafeInteger(candidate.faction.members) && candidate.faction.members >= 0))
    && (candidate.chain === null || (isRecord(candidate.chain)
      && ["active", "cooldown", "idle"].includes(candidate.chain.state)
      && [candidate.chain.id, candidate.chain.current, candidate.chain.maximum, candidate.chain.timeoutSeconds,
        candidate.chain.modifier, candidate.chain.cooldownSeconds, candidate.chain.startedAt, candidate.chain.endedAt].every(isNonNegativeNumber)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
