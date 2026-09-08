import { z } from "zod";

/**
 * A personal Targets list. Each operator curates their own list of Torn players
 * (by ID) and Chainward keeps a cached snapshot of each target's public profile —
 * status, last action, level, faction, life — refreshed from the operator's own
 * Torn key.
 */

export const MAX_TARGETS = 75;
export const MAX_TAGS_PER_TARGET = 6;
export const MAX_TAG_LENGTH = 24;
/** A snapshot older than this is refreshed on the next page load. */
export const TARGET_STALE_MS = 90_000;

export const targetTagSchema = z.string().trim().toLowerCase().min(1).max(MAX_TAG_LENGTH).regex(/^[a-z0-9][a-z0-9 _-]*$/);

export const targetEntrySchema = z.object({
  tornUserId: z.number().int().positive(),
  label: z.string().trim().max(60).default(""),
  note: z.string().trim().max(280).default(""),
  /** Pinned targets sort to the top of every view. */
  pinned: z.boolean().default(false),
  /** Freeform organisation labels ("war", "farm", "watch"). */
  tags: z.array(targetTagSchema).max(MAX_TAGS_PER_TARGET).default([]),
  addedAt: z.string().datetime(),
});

export const targetStatusSchema = z.object({
  description: z.string().default(""),
  state: z.string().default(""),
  until: z.number().int().nonnegative().nullable().default(null),
  color: z.string().default(""),
});

/** The operator's most recent attack against this target, from their own log. */
export const targetLastHitSchema = z.object({
  at: z.number().int().nonnegative(),
  result: z.string().default(""),
  respect: z.number().default(0),
});

export const targetSnapshotSchema = z.object({
  tornUserId: z.number().int().positive(),
  name: z.string().default(""),
  level: z.number().int().nonnegative().default(0),
  factionId: z.number().int().nonnegative().nullable().default(null),
  factionName: z.string().default(""),
  position: z.string().default(""),
  status: targetStatusSchema,
  lastActionAt: z.number().int().nonnegative().default(0),
  lastActionRelative: z.string().default(""),
  lastActionStatus: z.string().default(""),
  lifeCurrent: z.number().int().nonnegative().default(0),
  lifeMaximum: z.number().int().nonnegative().default(0),
  attackable: z.boolean().default(false),
  /** The operator's last attack on this target, or null if none in the log. */
  lastHit: targetLastHitSchema.nullable().default(null),
  /** This target has attacked the operator more recently than the operator hit them. */
  hitYouBack: z.boolean().default(false),
  /** Sum of active bounty rewards on this player, and how many are stacked. */
  bountyTotal: z.number().nonnegative().default(0),
  bountyCount: z.number().int().nonnegative().default(0),
  fetchedAt: z.string().datetime(),
});

export const targetListSchema = z.object({
  entries: z.array(targetEntrySchema).max(MAX_TARGETS).default([]),
  snapshots: z.record(z.string(), targetSnapshotSchema).default({}),
});

export type TargetEntry = z.infer<typeof targetEntrySchema>;
export type TargetSnapshot = z.infer<typeof targetSnapshotSchema>;
export type TargetLastHit = z.infer<typeof targetLastHitSchema>;
export type TargetList = z.infer<typeof targetListSchema>;

/** Normalises a raw tag string; returns null when nothing usable remains. */
export function normaliseTag(raw: string): string | null {
  const value = raw.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, "").replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH).trim();
  return value.length > 0 ? value : null;
}

/** Parses a block of pasted IDs / profile links into a de-duplicated id list. */
export function parseTornUserIdList(raw: string): number[] {
  const ids = new Set<number>();
  for (const token of raw.split(/[\s,;]+/)) {
    const id = parseTornUserId(token);
    if (id) ids.add(id);
  }
  return [...ids];
}

/** A target is attackable only when they are in the "Okay" state. */
export function isAttackableState(state: string): boolean {
  return state.trim().toLowerCase() === "okay";
}

export type FairFightDifficulty = "easy" | "moderate" | "difficult" | "extreme";

/** Matches ffscouter.com's own difficulty bands. Lives here (not in the
 *  server-only `ffscouter.ts`) so the client-rendered badge can call it too. */
export function fairFightDifficulty(fairFight: number): FairFightDifficulty {
  if (fairFight <= 2) return "easy";
  if (fairFight <= 3.5) return "moderate";
  if (fairFight <= 4.5) return "difficult";
  return "extreme";
}

/**
 * Accepts a bare numeric ID, a Torn profile URL / query fragment
 * (`profiles.php?XID=123`), or an attack-loader link (`loader.php?sid=attack&
 * user2ID=123` — the same format this feature's own Attack buttons generate)
 * and returns the Torn user ID, or null when nothing usable is present.
 */
export function parseTornUserId(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const match = trimmed.match(/[?&]xid=(\d+)/i) ?? trimmed.match(/[?&]user2id=(\d+)/i) ?? trimmed.match(/profiles\.php\D+(\d+)/i);
  if (match) {
    const value = Number(match[1]);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  return null;
}
