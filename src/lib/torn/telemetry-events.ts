import type { WorkspaceTelemetry } from "./telemetry-types";

interface WorkspaceTelemetryEventDetail {
  telemetry: WorkspaceTelemetry;
  transitMs: number;
}

/** Creates the shared client event without adding transport fields to the DTO. */
export function workspaceTelemetryEvent(
  telemetry: WorkspaceTelemetry,
  transitMs = 0,
): CustomEvent<WorkspaceTelemetryEventDetail> {
  return new CustomEvent("chainward:telemetry", {
    detail: { telemetry, transitMs: Math.max(0, transitMs) },
  });
}

/** Accepts the new envelope and the original plain-detail event during HMR. */
export function readWorkspaceTelemetryEvent(event: Event): {
  telemetry: unknown;
  transitMs: number;
} {
  const detail: unknown = (event as CustomEvent<unknown>).detail;
  if (detail && typeof detail === "object" && "telemetry" in detail) {
    const candidate = detail as Partial<WorkspaceTelemetryEventDetail>;
    return {
      telemetry: candidate.telemetry,
      transitMs: typeof candidate.transitMs === "number" && Number.isFinite(candidate.transitMs)
        ? Math.max(0, candidate.transitMs)
        : 0,
    };
  }
  return { telemetry: detail, transitMs: 0 };
}
