import "server-only";

import { TornClient } from "./client";
import { normalizeTornProfileImageUrl } from "./profile-image";
import type { ChainReportResponse, ChainsResponse, FactionBasicResponse, FactionMembersResponse, KeyInfoResponse, OngoingChainResponse, UserBasicResponse, UserProfileResponse } from "./schemas";

const requiredFactionSelections = ["basic", "chain", "chains", "chainreport", "members"] as const;
const requiredUserSelections = ["basic", "profile"] as const;

export interface ValidatedTornConnection {
  player: { id: number; name: string; imageUrl: string | null };
  faction: { id: number; name: string; tag: string };
  key: { accessType: string; hasFactionPermission: boolean; selections: string[] };
  capabilities: {
    identity: "verified";
    faction: "verified";
    liveChain: "verified";
    completedChains: "verified";
    members: "verified";
    chainReports: "verified" | "available";
  };
  checkedAt: string;
}

interface ConnectionClient {
  getKeyInfo(): Promise<KeyInfoResponse>;
  getMyProfile(): Promise<UserBasicResponse>;
  getMyProfileDetails(): Promise<UserProfileResponse>;
  getFactionBasic(factionId?: number): Promise<FactionBasicResponse>;
  getCurrentChain(factionId?: number): Promise<OngoingChainResponse>;
  getCompletedChains(factionId?: number, options?: { limit?: number }): Promise<ChainsResponse>;
  getFactionMembers(factionId?: number): Promise<FactionMembersResponse>;
  getChainReport(chainId?: number): Promise<ChainReportResponse>;
}

export class MissingTornSelectionsError extends Error {
  constructor(readonly missingSelections: readonly string[]) {
    super(`The API key is missing: ${missingSelections.join(", ")}.`);
    this.name = "MissingTornSelectionsError";
  }
}

export async function validateTornConnection(apiKey: string, clientOptions: Omit<ConstructorParameters<typeof TornClient>[0], "apiKey"> = {}): Promise<ValidatedTornConnection> {
  return validateTornConnectionWithClient(new TornClient({ ...clientOptions, apiKey }));
}

export async function validateTornConnectionWithClient(client: ConnectionClient): Promise<ValidatedTornConnection> {
  const keyInfo = await client.getKeyInfo();
  const factionId = keyInfo.info.user.faction_id;
  if (!factionId) throw new Error("The Torn account is not currently in a faction.");

  if (keyInfo.info.access.type === "Custom") {
    const selectedFaction = new Set(keyInfo.info.selections.faction);
    const selectedUser = new Set(keyInfo.info.selections.user);
    const missing = [
      ...requiredFactionSelections.filter((name) => !selectedFaction.has(name)).map((name) => `faction/${name}`),
      ...requiredUserSelections.filter((name) => !selectedUser.has(name)).map((name) => `user/${name}`),
    ];
    if (missing.length > 0) throw new MissingTornSelectionsError(missing);
  }

  const [profile, profileDetails, faction, currentChain, completedChains, members] = await Promise.all([
    client.getMyProfile(),
    client.getMyProfileDetails(),
    client.getFactionBasic(factionId),
    client.getCurrentChain(),
    client.getCompletedChains(undefined, { limit: 1 }),
    client.getFactionMembers(),
  ]);

  if (profile.profile.id !== keyInfo.info.user.id) throw new Error("The API key identity response was inconsistent.");
  if (profileDetails.profile.id !== profile.profile.id) throw new Error("The API key profile response was inconsistent.");
  if (faction.basic.id !== factionId) throw new Error("The API key faction response was inconsistent.");
  if (currentChain.chain.id < 0) throw new Error("The live-chain response was inconsistent.");
  if (!Array.isArray(members.members) || !Array.isArray(completedChains.chains)) throw new Error("A faction capability response was inconsistent.");

  const reportChain = completedChains.chains[0];
  if (reportChain) {
    const report = await client.getChainReport(reportChain.id);
    if (report.chainreport.id !== reportChain.id) throw new Error("The chain-report response was inconsistent.");
  }

  return {
    player: {
      id: profile.profile.id,
      name: profile.profile.name,
      imageUrl: normalizeTornProfileImageUrl(profileDetails.profile.image),
    },
    faction: { id: faction.basic.id, name: faction.basic.name, tag: faction.basic.tag },
    key: { accessType: keyInfo.info.access.type, hasFactionPermission: keyInfo.info.access.faction, selections: [...keyInfo.info.selections.faction] },
    capabilities: {
      identity: "verified",
      faction: "verified",
      liveChain: "verified",
      completedChains: "verified",
      members: "verified",
      chainReports: reportChain ? "verified" : "available",
    },
    checkedAt: new Date().toISOString(),
  };
}
