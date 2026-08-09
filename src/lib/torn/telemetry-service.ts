import "server-only";

import { cache } from "react";
import type { TornRequestOptions } from "./client";
import { TornApiError, userFacingTornError } from "./errors";
import type { FactionBasicResponse, OngoingChainResponse } from "./schemas";
import { getConfiguredTornClient } from "./server-client";
import type { ChainOperationalState, WorkspaceTelemetry } from "./telemetry-types";

interface TelemetryClient {
  getFactionBasic(factionId?: number, options?: TornRequestOptions): Promise<FactionBasicResponse>;
  getCurrentChain(factionId?: number, options?: TornRequestOptions): Promise<OngoingChainResponse>;
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
    return mapTornTelemetry(faction, chain, now ?? new Date());
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
): WorkspaceTelemetry {
  const { basic } = factionResponse;
  const { chain } = chainResponse;
  return {
    source: "live",
    checkedAt: checkedAt.toISOString(),
    faction: { id: basic.id, name: basic.name, tag: basic.tag, members: basic.members },
    chain: {
      id: chain.id,
      current: chain.current,
      maximum: chain.max,
      timeoutSeconds: chain.timeout,
      modifier: chain.modifier,
      cooldownAt: chain.cooldown,
      startedAt: chain.start,
      endedAt: chain.end,
      state: operationalState(chain, Math.floor(checkedAt.getTime() / 1_000)),
    },
    message: "Verified Torn API data. Automatic updates respect Torn's service cache; Sync now requests an uncached snapshot.",
  };
}

function operationalState(chain: OngoingChainResponse["chain"], nowSeconds: number): ChainOperationalState {
  if (chain.cooldown > nowSeconds) return "cooldown";
  if (chain.current > 0 && chain.end === 0) return "active";
  return "idle";
}

function unavailableTelemetry(now: Date, message: string): WorkspaceTelemetry {
  return { source: "unavailable", checkedAt: now.toISOString(), faction: null, chain: null, message };
}
