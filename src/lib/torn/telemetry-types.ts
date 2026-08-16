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
  /** Seconds remaining before the chain drops, as reported at `checkedAt`. */
  timeoutSeconds: number;
  modifier: number;
  /**
   * Seconds remaining of the post-chain cooldown, derived from Torn's absolute
   * `cooldown` timestamp at `checkedAt`.
   */
  cooldownSeconds: number;
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
  mode?: "torn" | "offline";
  checkedAt: string;
  /**
   * How long ago Torn answered the chain request, in milliseconds, measured
   * entirely within this server's own clock. The countdown subtracts it from
   * Torn's reported remaining seconds, so no client ever has to agree with
   * another machine about what time it is.
   */
  dataAgeMs?: number;
  faction: SafeFactionTelemetry | null;
  chain: SafeChainTelemetry | null;
  message: string;
}
