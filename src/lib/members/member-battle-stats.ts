import { z } from "zod";

/**
 * Battle-stat self-share, relocated from the retired Organized Crimes workspace.
 * A member opts in with their own Torn key; leadership reviews the shared
 * snapshots on the Members workspace. The CPR / organized-crime modelling that
 * used to sit alongside this is gone — only the four battle stats and their
 * total are kept.
 */

const stat = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const battleStatsSchema = z.object({ strength: stat, defense: stat, speed: stat, dexterity: stat, total: stat });

// Torn API v2 has shipped `/user/battlestats` as both a flat number per stat and
// as `{ value: number }`, and may add more keys. Keep the envelope permissive and
// normalise the numbers in the data helper so a shape change degrades to a clear
// message instead of a validation crash.
export const battleStatsResponseSchema = z.object({
  battlestats: z.record(z.string(), z.unknown()),
}).loose();

export const memberBattleStatsSchema = z.object({
  factionId: z.number().int().positive(),
  tornUserId: z.number().int().positive(),
  stats: battleStatsSchema,
  statsAt: z.string().datetime(),
  source: z.enum(["torn", "offline"]),
});

/** Per-member sharing preference. `autoShare` re-pushes the member's own stats
 *  whenever they open the workspace and the last snapshot is stale. */
export const battleStatsSharePreferenceSchema = z.object({
  autoShare: z.boolean(),
  lastAutoShareAt: z.string().datetime().nullable().optional(),
});

export type BattleStats = z.infer<typeof battleStatsSchema>;
export type MemberBattleStats = z.infer<typeof memberBattleStatsSchema>;
export type BattleStatsSharePreference = z.infer<typeof battleStatsSharePreferenceSchema>;

/** A shared snapshot older than this is flagged for a refresh. */
export const STATS_FRESH_MS = 7 * 86_400_000;
/** Automatic re-share fires when the last snapshot is older than this. */
export const AUTO_SHARE_STALE_MS = 12 * 60 * 60 * 1_000;

export function isBattleStatsFresh(at: string | null, now: number, maxAge = STATS_FRESH_MS): boolean {
  if (!at) return false;
  const age = now - Date.parse(at);
  return Number.isFinite(age) && age >= 0 && age <= maxAge;
}
