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
}

interface TelemetryRequestOptions {
  faction?: TornRequestOptions;
  chain?: TornRequestOptions;
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
    return loadWorkspaceTelemetry(client, undefined, {
      // Faction identity can use its normal cache. Only the countdown needs a
      // unique request, keeping active polling to one quota-consuming call.
      chain: { forceRefresh: true, bypassUpstreamCache: true },
    });
  } catch {
    return unavailableTelemetry(new Date(), "The encrypted Torn connection could not be initialized. Reconnect the API key in Settings.");
  }
}

export async function loadWorkspaceTelemetry(
  client: TelemetryClient,
  now?: Date,
  requestOptions: TelemetryRequestOptions = {},
): Promise<WorkspaceTelemetry> {
  try {
    const [faction, chain] = await Promise.all([
      client.getFactionBasic(undefined, requestOptions.faction),
      client.getCurrentChain(undefined, requestOptions.chain),
    ]);
    const chainFetchedAt = client.getCurrentChainFetchedAt?.() ?? null;
    return mapTornTelemetry(faction, chain, now ?? new Date(), client.dataMode ?? "torn", chainFetchedAt);
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
): WorkspaceTelemetry {
  const { basic } = factionResponse;
  const { chain } = chainResponse;
  const checkedAtSeconds = Math.floor(checkedAt.getTime() / 1_000);
  // How stale Torn's countdown already is. Both readings come from this
  // machine's clock, so the subtraction is exact — unlike a deadline expressed
  // on one clock and read against another.
  const dataAgeMs = chainFetchedAtMs === null ? 0 : Math.max(0, checkedAt.getTime() - chainFetchedAtMs);
  return {
    dataAgeMs,
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
      cooldownSeconds: Math.max(0, chain.cooldown - checkedAtSeconds),
      startedAt: chain.start,
      endedAt: chain.end,
      state: operationalState(chain, checkedAtSeconds),
    },
    message: mode === "offline"
      ? "Offline test fixture. No request was sent to Torn and no values on this screen are live."
      : "Verified Torn API data. Active-chain checks request uncached snapshots for timer accuracy.",
  };
}

/**
 * `timeout` is the only unambiguous liveness signal: it is the countdown to the
 * chain dropping, so it is above zero while and only while a chain is running.
 * `end` is deliberately not used to decide this. It was previously treated as
 * "zero until the chain finishes", and a live chain that already carried an end
 * timestamp was therefore reported as idle while its hit count kept climbing.
 */
function operationalState(chain: OngoingChainResponse["chain"], checkedAtSeconds: number): ChainOperationalState {
  const running = chain.id > 0 && chain.timeout > 0;
  if (running && chain.current > 0) return "active";
  // The current OpenAPI schema defines `cooldown` as the timestamp at which the
  // cooldown ends, unlike `timeout`, which is a remaining duration.
  if (chain.cooldown > checkedAtSeconds) return "cooldown";
  return "idle";
}

function unavailableTelemetry(now: Date, message: string): WorkspaceTelemetry {
  return { source: "unavailable", mode: "torn", checkedAt: now.toISOString(), faction: null, chain: null, message };
}
