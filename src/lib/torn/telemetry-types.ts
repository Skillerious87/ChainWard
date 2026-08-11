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
   * Seconds remaining of the post-chain cooldown, as reported at `checkedAt`.
   * Torn returns a duration here, not a timestamp.
   */
  cooldownSeconds: number;
  startedAt: number;
  endedAt: number;
  /**
   * Absolute unix seconds at which the chain drops, computed from Torn's
   * remaining-seconds figure and the moment Torn actually answered. Counting
   * down to a fixed instant keeps the timer identical across page loads, where
   * counting `timeoutSeconds` from render time restarts it on every refresh.
   */
  timeoutAt: number;
  /** Absolute unix seconds at which the cooldown clears. Zero when none. */
  cooldownAt: number;
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
   * Epoch milliseconds on Torn's clock at the moment this payload was built,
   * taken from Torn's own `Date` response header. Chain deadlines are expressed
   * on the same clock, so a browser whose system time is wrong can measure its
   * offset from this and still count down accurately.
   */
  clockAt?: number;
  faction: SafeFactionTelemetry | null;
  chain: SafeChainTelemetry | null;
  message: string;
}
