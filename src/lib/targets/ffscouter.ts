import "server-only";

import { z } from "zod";
import { getOwnBattleStatsDraft } from "@/lib/members/member-battle-stats-data";
import { acquireConcurrencySlot } from "@/lib/security/rate-limit";
import { readFfscouterKey } from "./ffscouter-key-store";

/**
 * Fair Fight estimation via ffscouter.com — an independent, free, widely-used
 * community tool (not affiliated with Torn) that crowd-sources battle-stat
 * estimates for arbitrary players and exposes them through a public API.
 * Torn's own API never exposes another player's battle stats (by design —
 * that's private game information), so this is the only practical source of
 * a pre-attack winnability signal short of running our own spy network.
 *
 * Torn's Fair Fight bonus: FF = 1 + (8/3) * (defenderBSS / attackerBSS), where
 * BSS ("Battle Stat Score") = round(sqrt(str) + sqrt(def) + sqrt(spd) + sqrt(dex)).
 * We deliberately compute FF ourselves from the operator's own *exact* battle
 * stats (already readable via the connected Torn key — see
 * getOwnBattleStatsDraft) combined with FFScouter's estimate of the target's
 * stats, rather than trusting FFScouter's own bundled `fair_fight` field,
 * which depends on FFScouter separately knowing the requester's stats
 * accurately (it may not, or may be stale).
 */

export interface FairFightInfo {
  tornUserId: number;
  bsEstimate: number | null;
  /** Computed here, using the operator's own real BSS. Null when either side's BSS is unknown. */
  fairFight: number | null;
  source: string;
  /** FFScouter's own staleness clock for this estimate (unix seconds). */
  lastUpdated: number;
}

const ffscouterStatSchema = z.object({
  player_id: z.number().int().positive(),
  bs_estimate: z.number().int().nonnegative().nullable().catch(null),
  last_updated: z.number().int().nonnegative().catch(0),
  source: z.string().default(""),
}).loose();
const ffscouterResponseSchema = z.array(ffscouterStatSchema).catch([]);

const FFSCOUTER_URL = "https://ffscouter.com/api/v1/get-stats";
/** Documented cap is 205 targets per request; stay comfortably under it. */
const FFSCOUTER_BATCH_SIZE = 200;
/** FFScouter's own rate limit (20/min) is per IP, i.e. shared by every
 *  Chainward operator on this deployment — a global, not per-operator, gate. */
const FFSCOUTER_CONCURRENCY_SCOPE = "ffscouter:fetch";

interface CachedEstimate { bsEstimate: number | null; source: string; lastUpdated: number }
interface CacheEntry { expiresAt: number; estimate: CachedEstimate }

/**
 * Process-wide, in-memory only — deliberately never persisted. FFScouter's
 * estimate of a player's own stats is public, shared data (not personalized
 * to whoever asks), so this cache is correctly keyed by target id alone and
 * benefits every operator on this deployment, not just whoever's key made the
 * call. FFScouter already caches server-side for up to 5 minutes; matching
 * that here avoids inventing a second, persisted staleness concept on top of
 * one that already exists.
 */
const estimateCache = new Map<number, CacheEntry>();
const CACHE_MS = 5 * 60_000;

export function bssFromStats(stats: { strength: number; defense: number; speed: number; dexterity: number }): number {
  return Math.round(Math.sqrt(stats.strength) + Math.sqrt(stats.defense) + Math.sqrt(stats.speed) + Math.sqrt(stats.dexterity));
}

export function computeFairFight(myBss: number, targetBss: number): number | null {
  if (myBss <= 0 || targetBss <= 0) return null;
  return 1 + (8 / 3) * (targetBss / myBss);
}

/**
 * Fetches Fair Fight estimates for up to a batch of targets, computed against
 * the operator's own real BSS. Never throws: a missing/invalid key,
 * FFScouter being unavailable, a timeout, or an unexpected response shape all
 * degrade to fewer (or no) entries in the returned map — this is enrichment
 * only and must never block or fail a Torn-sourced target refresh, the same
 * tolerance already applied to attack-log enrichment (see loadHitIndex).
 */
export async function fetchFairFightEstimates(apiKey: string, tornUserIds: number[], myBss: number): Promise<Map<number, FairFightInfo>> {
  const result = new Map<number, FairFightInfo>();
  if (tornUserIds.length === 0 || myBss <= 0) return result;

  const uncached: number[] = [];
  const now = Date.now();
  for (const tornUserId of tornUserIds) {
    const cached = estimateCache.get(tornUserId);
    if (cached && cached.expiresAt > now) result.set(tornUserId, toFairFightInfo(tornUserId, cached.estimate, myBss));
    else uncached.push(tornUserId);
  }
  if (uncached.length === 0) return result;

  for (let index = 0; index < uncached.length; index += FFSCOUTER_BATCH_SIZE) {
    const batch = uncached.slice(index, index + FFSCOUTER_BATCH_SIZE);
    const release = acquireConcurrencySlot(FFSCOUTER_CONCURRENCY_SCOPE, "global", 1);
    if (!release) continue; // Another request is already in flight — skip rather than wait; this is a bonus signal, not core data.
    try {
      const url = new URL(FFSCOUTER_URL);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("targets", batch.join(","));
      const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) continue;
      const payload = ffscouterResponseSchema.parse(await response.json());
      for (const entry of payload) {
        const estimate: CachedEstimate = { bsEstimate: entry.bs_estimate, source: entry.source, lastUpdated: entry.last_updated };
        estimateCache.set(entry.player_id, { expiresAt: Date.now() + CACHE_MS, estimate });
        result.set(entry.player_id, toFairFightInfo(entry.player_id, estimate, myBss));
      }
    } catch {
      // Network failure, timeout, or malformed payload — leave this batch unenriched.
    } finally {
      release();
    }
  }
  return result;
}

function toFairFightInfo(tornUserId: number, estimate: CachedEstimate, myBss: number): FairFightInfo {
  return {
    tornUserId,
    bsEstimate: estimate.bsEstimate,
    fairFight: estimate.bsEstimate !== null ? computeFairFight(myBss, estimate.bsEstimate) : null,
    source: estimate.source,
    lastUpdated: estimate.lastUpdated,
  };
}

/**
 * The single entry point other code should call: resolves the operator's
 * FFScouter key and real battle stats, then fetches estimates — or returns an
 * empty map immediately (no network call at all) when either isn't
 * available, so the feature costs nothing until an operator opts in.
 */
export async function enrichWithFairFight(factionId: number, operatorId: number, tornUserIds: number[]): Promise<Map<number, FairFightInfo>> {
  if (tornUserIds.length === 0) return new Map();
  const apiKey = await readFfscouterKey(factionId, operatorId);
  if (!apiKey) return new Map();
  const stats = await getOwnBattleStatsDraft();
  if (!stats.ok) return new Map();
  const myBss = bssFromStats(stats.draft.stats);
  if (myBss <= 0) return new Map();
  return fetchFairFightEstimates(apiKey, tornUserIds, myBss);
}
