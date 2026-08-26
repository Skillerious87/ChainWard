import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";
import type { FactionAccessSummary } from "./types";

export function redactLockedTelemetry(telemetry: WorkspaceTelemetry, access: FactionAccessSummary, workspaceAuthorized = access.state === "active"): WorkspaceTelemetry {
  if (access.state === "active" && workspaceAuthorized) return telemetry;
  return {
    ...telemetry,
    chain: null,
    message: telemetry.mode === "offline"
      ? "Offline test identity connected. Operational fixture values remain hidden until this player and faction are authorised."
      : "Torn identity and faction verified. Operational values remain hidden until this player and faction are authorised.",
  };
}
