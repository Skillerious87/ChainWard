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
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkspaceTelemetry>;
  return (candidate.source === "live" || candidate.source === "unavailable")
    && typeof candidate.checkedAt === "string"
    && typeof candidate.message === "string"
    && (candidate.faction === null || typeof candidate.faction === "object")
    && (candidate.chain === null || typeof candidate.chain === "object");
}
