export type TelemetrySource = "live" | "unavailable";

export type ChainOperationalState = "active" | "cooldown" | "idle";

export interface SafeFactionTelemetry {
  id: number;
  name: string;
  tag: string;
  members: number;
}

export interface SafeChainTelemetry {
  id: number;
  current: number;
  maximum: number;
  timeoutSeconds: number;
  modifier: number;
  cooldownAt: number;
  startedAt: number;
  endedAt: number;
  state: ChainOperationalState;
}

/**
 * Client-safe data transfer object. It deliberately contains neither the API
 * key nor Torn's raw response payload.
 */
export interface WorkspaceTelemetry {
  source: TelemetrySource;
  checkedAt: string;
  faction: SafeFactionTelemetry | null;
  chain: SafeChainTelemetry | null;
  message: string;
}
