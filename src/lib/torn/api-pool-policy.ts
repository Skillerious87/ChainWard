import { createHash } from "node:crypto";
import { z } from "zod";
import { chainReportResponseSchema, chainsResponseSchema, factionBasicResponseSchema, factionMembersResponseSchema, ongoingChainResponseSchema } from "./schemas";
import type { FactionPoolRequest } from "./api-pool-types";

export function tornCredentialFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function factionPoolOperation(path: string, factionId: number): "basic" | "chain" | "chains" | "members" | "chainreport" | null {
  const factionPath = path.match(/^\/faction(?:\/(\d+))?\/(basic|chain|chains|members|chainreport)$/);
  if (!factionPath) return null;
  const operation = factionPath[2] as "basic" | "chain" | "chains" | "members" | "chainreport";
  if (operation !== "chainreport" && factionPath[1] && Number(factionPath[1]) !== factionId) return null;
  return operation;
}

export function canonicalFactionPoolRequest(request: FactionPoolRequest, factionId: number): FactionPoolRequest {
  const operation = factionPoolOperation(request.path, factionId);
  if (!operation) throw new Error("This operation cannot use faction API contributions.");
  const query: Record<string, string> = {};
  if (operation === "chains") {
    for (const parameter of ["from", "to", "limit"]) {
      const value = request.query[parameter];
      if (value !== undefined) {
        const numeric = Number(value);
        if (!Number.isSafeInteger(numeric) || numeric < 0 || (parameter === "limit" && (numeric < 1 || numeric > 100))) throw new Error("Invalid chain history parameters.");
        query[parameter] = String(numeric);
      }
    }
    query.sort = "DESC";
  }
  const entity = request.path.match(/^\/faction\/(\d+)\/chainreport$/)?.[1];
  const path = operation === "chainreport" ? entity ? `/faction/${entity}/chainreport` : "/faction/chainreport" : `/faction/${factionId}/${operation}`;
  const minimumCacheMs = operation === "chain" ? 5_000 : operation === "chainreport" ? 15_000 : 30_000;
  return { path, query, cacheMs: Math.max(minimumCacheMs, Math.min(request.cacheMs, operation === "chains" ? 600_000 : operation === "chainreport" ? 600_000 : 60_000)), forceRefresh: request.forceRefresh };
}

export function factionPoolCacheKey(request: FactionPoolRequest, factionId: number): string {
  return `cache:faction:${factionId}:public-v1:${request.path}:${new URLSearchParams(Object.entries(request.query).sort(([left], [right]) => left.localeCompare(right))).toString()}`;
}

export function projectFactionPoolResponse(request: FactionPoolRequest, factionId: number, payload: unknown): unknown {
  const operation = factionPoolOperation(request.path, factionId);
  if (operation === "chain") return ongoingChainResponseSchema.parse(payload);
  if (operation === "chains") {
    const response = chainsResponseSchema.parse(payload);
    return { chains: response.chains, _metadata: { links: null } };
  }
  if (operation === "chainreport") {
    const response = chainReportResponseSchema.parse(payload);
    const requestedId = request.path.match(/^\/faction\/(\d+)\/chainreport$/)?.[1];
    if (response.chainreport.faction_id !== factionId || (requestedId && response.chainreport.id !== Number(requestedId))) throw new Error("The chain report does not belong to this faction.");
    return response;
  }
  if (operation === "basic") {
    const response = factionBasicResponseSchema.parse(payload);
    if (response.basic.id !== factionId) throw new Error("The Torn response belongs to a different faction.");
    const { note: omittedNote, ...basic } = response.basic;
    void omittedNote;
    return { basic: { ...basic, rank: null, is_enlisted: null } };
  }
  if (operation === "members") {
    const response = factionMembersResponseSchema.parse(payload);
    const statusSchema = z.object({ description: z.string(), details: z.string().nullable(), state: z.string(), until: z.number().nullable(), color: z.string() });
    return { members: response.members.map((member) => ({ ...member, revive_setting: "Unknown", status: statusSchema.parse(member.status) })) };
  }
  throw new Error("This Torn response cannot be shared.");
}
