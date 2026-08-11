import "server-only";

import { cache } from "react";
import type { TornRequestOptions } from "./client";
import { TornApiError, userFacingTornError } from "./errors";
import type { FactionBasicResponse, OngoingChainResponse } from "./schemas";
import { getConfiguredTornClient } from "./server-client";
import type { ChainOperationalState, WorkspaceTelemetry } from "./telemetry-types";

interface TelemetryClient {
  dataMode?: "torn" | "offline";
  getFactionBasic(factionId?: number, options?: TornRequestOptions): Promise<FactionBasicResponse>;
  getCurrentChain(factionId?: number, options?: TornRequestOptions): Promise<OngoingChainResponse>;
  /** Milliseconds at which Torn answered the chain request now in hand. */
  getCurrentChainFetchedAt?(): number | null;
  /** Offset between Torn's clock and this machine's, in milliseconds. */
  getClockSkewMs?(): number;
}

export const getWorkspaceTelemetry = cache(async (): Promise<WorkspaceTelemetry> => {
  try {
    const client = await getConfiguredTornClient();
    if (!client) return unavailableTelemetry(new Date(), "Connect a Torn API key to load verified faction data.");
    return loadWorkspaceTelemetry(client);
  } catch {
    return unavailableTelemetry(new Date(), "The encrypted Torn connection could not be initialized. Reconnect the API key in Settings.");
  }
});

export async function getFreshWorkspaceTelemetry(): Promise<WorkspaceTelemetry> {
  try {
    const client = await getConfiguredTornClient();
    if (!client) return unavailableTelemetry(new Date(), "Connect a Torn API key to load verified faction data.");
    return loadWorkspaceTelemetry(client, undefined, { forceRefresh: true, bypassUpstreamCache: true });
  } catch {
    return unavailableTelemetry(new Date(), "The encrypted Torn connection could not be initialized. Reconnect the API key in Settings.");
  }
}

export async function loadWorkspaceTelemetry(
  client: TelemetryClient,
  now?: Date,
  requestOptions: TornRequestOptions = {},
): Promise<WorkspaceTelemetry> {
  try {
    const [faction, chain] = await Promise.all([
      client.getFactionBasic(undefined, requestOptions),
      client.getCurrentChain(undefined, requestOptions),
    ]);
    const chainFetchedAt = client.getCurrentChainFetchedAt?.() ?? null;
    const clockSkewMs = client.getClockSkewMs?.() ?? 0;
    return mapTornTelemetry(faction, chain, now ?? new Date(), client.dataMode ?? "torn", chainFetchedAt, clockSkewMs);
  } catch (error: unknown) {
    const message = error instanceof TornApiError
      ? userFacingTornError(error)
      : "Live Torn data could not be validated. No operational values are being shown.";
    return unavailableTelemetry(now ?? new Date(), message);
  }
}

export function mapTornTelemetry(
  factionResponse: FactionBasicResponse,
  chainResponse: OngoingChainResponse,
  checkedAt: Date,
  mode: "torn" | "offline" = "torn",
  chainFetchedAtMs: number | null = null,
  clockSkewMs = 0,
): WorkspaceTelemetry {
  const { basic } = factionResponse;
  const { chain } = chainResponse;
  // Countdowns are anchored to the moment Torn answered — not to render time,
  // which would restart the clock whenever a cached response was reused — and
  // are expressed on Torn's clock so no machine's local drift enters the sum.
  const anchorSeconds = Math.floor(((chainFetchedAtMs ?? checkedAt.getTime()) + clockSkewMs) / 1_000);
  return {
    clockAt: checkedAt.getTime() + clockSkewMs,
    source: "live",
    mode,
    checkedAt: checkedAt.toISOString(),
    faction: { id: basic.id, name: basic.name, tag: basic.tag, members: basic.members },
    chain: {
      id: chain.id,
      current: chain.current,
      maximum: chain.max,
      timeoutSeconds: chain.timeout,
      modifier: chain.modifier,
      cooldownSeconds: chain.cooldown,
      startedAt: chain.start,
      endedAt: chain.end,
      timeoutAt: chain.timeout > 0 ? anchorSeconds + chain.timeout : 0,
      cooldownAt: chain.cooldown > 0 ? anchorSeconds + chain.cooldown : 0,
      state: operationalState(chain),
    },
    message: mode === "offline"
      ? "Offline test fixture. No request was sent to Torn and no values on this screen are live."
      : "Verified Torn API data. Automatic updates respect Torn's service cache; Sync now requests an uncached snapshot.",
  };
}

/**
 * Torn reports `timeout` and `cooldown` as seconds remaining, not as unix
 * timestamps. Comparing `cooldown` against the current epoch second — as this
 * did — is always false, so the cooldown state could never be reached.
 *
 * `timeout` is the only unambiguous liveness signal: it is the countdown to the
 * chain dropping, so it is above zero while and only while a chain is running.
 * `end` is deliberately not used to decide this. It was previously treated as
 * "zero until the chain finishes", and a live chain that already carried an end
 * timestamp was therefore reported as idle while its hit count kept climbing.
 */
function operationalState(chain: OngoingChainResponse["chain"]): ChainOperationalState {
  const running = chain.id > 0 && chain.timeout > 0;
  if (running && chain.current > 0) return "active";
  if (chain.cooldown > 0) return "cooldown";
  return "idle";
}

function unavailableTelemetry(now: Date, message: string): WorkspaceTelemetry {
  return { source: "unavailable", mode: "torn", checkedAt: now.toISOString(), faction: null, chain: null, message };
}
