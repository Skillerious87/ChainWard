import "server-only";

import { cache } from "react";
import { TornApiError, userFacingTornError } from "./errors";
import { getConfiguredTornClient } from "./server-client";
import type { ChainReportResponse, FactionMembersResponse } from "./schemas";
import type { TornChainHistoryItem, TornChainReportView, TornContribution, TornDataResult, TornRosterMember } from "./workspace-types";

export const getFactionRoster = cache(async (): Promise<TornDataResult<TornRosterMember[]>> => {
  try {
    const client = await getConfiguredTornClient();
    if (!client) return unavailable([], "Connect a Torn API key to retrieve the faction roster.");
    const response = await client.getFactionMembers();
    return available(response.members.map(mapMember), "Roster retrieved from Torn API v2.");
  } catch (error: unknown) {
    return unavailable([], safeError(error));
  }
});

export const getCompletedChainHistory = cache(async (): Promise<TornDataResult<TornChainHistoryItem[]>> => {
  try {
    const client = await getConfiguredTornClient();
    if (!client) return unavailable([], "Connect a Torn API key to retrieve completed chains.");
    const response = await client.getCompletedChains(undefined, { limit: 100 });
    return available(response.chains.map((chain) => ({
      id: chain.id,
      hits: chain.chain,
      respect: chain.respect,
      startedAt: chain.start,
      endedAt: chain.end,
    })).toSorted((left, right) => right.endedAt - left.endedAt || right.id - left.id), "Completed chains retrieved from Torn API v2.");
  } catch (error: unknown) {
    return unavailable([], safeError(error));
  }
});

export const getChainReportView = cache(async (chainId: number): Promise<TornDataResult<TornChainReportView | null>> => {
  try {
    const client = await getConfiguredTornClient();
    if (!client) return unavailable(null, "Connect a Torn API key to retrieve this chain report.");
    const [report, members, faction] = await Promise.all([
      client.getChainReport(chainId),
      client.getFactionMembers(),
      client.getFactionBasic(),
    ]);
    if (report.chainreport.id !== chainId) {
      return unavailable(null, "Torn returned a different chain report, so no values were displayed.");
    }
    if (report.chainreport.faction_id !== faction.basic.id) {
      return unavailable(null, "This chain report does not belong to the connected faction.");
    }
    return available(mapReport(report, members), "Final chain report retrieved from Torn API v2.");
  } catch (error: unknown) {
    return unavailable(null, safeError(error));
  }
});

export const getCurrentChainReportView = cache(async (): Promise<TornDataResult<TornChainReportView | null>> => {
  try {
    const client = await getConfiguredTornClient();
    if (!client) return unavailable(null, "Connect a Torn API key to retrieve current contributions.");
    const [current, report, members, faction] = await Promise.all([
      client.getCurrentChain(),
      client.getChainReport(),
      client.getFactionMembers(),
      client.getFactionBasic(),
    ]);
    if (current.chain.id === 0 || report.chainreport.id !== current.chain.id) {
      return available(null, "Torn has not published a report matching the current chain.");
    }
    if (report.chainreport.faction_id !== faction.basic.id) {
      return unavailable(null, "The current report did not match the connected faction.");
    }
    return available(mapReport(report, members), "Current matching chain report retrieved from Torn API v2.");
  } catch (error: unknown) {
    return unavailable(null, safeError(error));
  }
});

function mapMember(member: FactionMembersResponse["members"][number]): TornRosterMember {
  return {
    tornId: member.id,
    name: member.name,
    position: member.position,
    level: member.level,
    daysInFaction: member.days_in_faction,
    lastAction: member.last_action.relative,
    lastActionAt: member.last_action.timestamp,
    status: member.status.state,
    statusDescription: member.status.description,
    statusUntil: member.status.until,
  };
}

export function mapReport(
  response: ChainReportResponse,
  membersResponse: FactionMembersResponse,
): TornChainReportView {
  const report = response.chainreport;
  const memberById = new Map(membersResponse.members.map((member) => [member.id, member]));
  const contributions: TornContribution[] = report.attackers
    .map((attacker) => {
      const member = memberById.get(attacker.id);
      const hits = attacker.attacks.leave + attacker.attacks.mug + attacker.attacks.hospitalize;
      return {
        rank: 0,
        name: member?.name ?? `Torn user ${attacker.id}`,
        tornId: attacker.id,
        hits,
        contribution: report.details.chain > 0 ? (hits / report.details.chain) * 100 : 0,
        respect: attacker.respect.total,
        status: member?.status.state ?? null,
      };
    })
    .toSorted((left, right) => right.hits - left.hits || right.respect - left.respect)
    .map((contribution, index) => ({ ...contribution, rank: index + 1 }));

  return {
    id: report.id,
    factionId: report.faction_id,
    startedAt: report.start,
    endedAt: report.end,
    hits: report.details.chain,
    respect: report.details.respect,
    contributorCount: report.attackers.length,
    targetCount: report.details.targets,
    contributions,
  };
}

function available<T>(data: T, message: string): TornDataResult<T> {
  return { available: true, checkedAt: new Date().toISOString(), data, message };
}

function unavailable<T>(data: T, message: string): TornDataResult<T> {
  return { available: false, checkedAt: new Date().toISOString(), data, message };
}

function safeError(error: unknown): string {
  return error instanceof TornApiError
    ? userFacingTornError(error)
    : "Torn data could not be validated. No values were displayed.";
}
