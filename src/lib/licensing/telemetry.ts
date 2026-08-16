import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";
import type { FactionAccessSummary } from "./types";

export function redactLockedTelemetry(telemetry: WorkspaceTelemetry, access: FactionAccessSummary): WorkspaceTelemetry {
  if (access.state === "active") return telemetry;
  return {
    ...telemetry,
    chain: null,
    message: telemetry.mode === "offline"
      ? "Offline test identity connected. Operational fixture values remain hidden until this faction is unlocked."
      : "Torn identity and faction verified. Operational values remain hidden until this faction is unlocked.",
  };
}
