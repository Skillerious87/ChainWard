import { z } from "zod";

/**
 * A personal Targets list. Each operator curates their own list of Torn players
 * (by ID) and Chainward keeps a cached snapshot of each target's public profile —
 * status, last action, level, faction, life — refreshed from the operator's own
 * Torn key.
 */

export const MAX_TARGETS = 40;
/** A snapshot older than this is refreshed on the next page load. */
export const TARGET_STALE_MS = 90_000;

export const targetEntrySchema = z.object({
  tornUserId: z.number().int().positive(),
  label: z.string().trim().max(60).default(""),
  note: z.string().trim().max(280).default(""),
  addedAt: z.string().datetime(),
});

export const targetStatusSchema = z.object({
  description: z.string().default(""),
  state: z.string().default(""),
  until: z.number().int().nonnegative().nullable().default(null),
  color: z.string().default(""),
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
  lifeCurrent: z.number().int().nonnegative().default(0),
  lifeMaximum: z.number().int().nonnegative().default(0),
  attackable: z.boolean().default(false),
  fetchedAt: z.string().datetime(),
});

export const targetListSchema = z.object({
  entries: z.array(targetEntrySchema).max(MAX_TARGETS).default([]),
  snapshots: z.record(z.string(), targetSnapshotSchema).default({}),
});

export type TargetEntry = z.infer<typeof targetEntrySchema>;
export type TargetSnapshot = z.infer<typeof targetSnapshotSchema>;
export type TargetList = z.infer<typeof targetListSchema>;

/** A target is attackable only when they are in the "Okay" state. */
export function isAttackableState(state: string): boolean {
  return state.trim().toLowerCase() === "okay";
}

/**
 * Accepts a bare numeric ID or a Torn profile URL / query fragment
 * (`profiles.php?XID=123`, `https://www.torn.com/profiles.php?XID=123`) and
 * returns the Torn user ID, or null when nothing usable is present.
 */
export function parseTornUserId(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const match = trimmed.match(/[?&]xid=(\d+)/i) ?? trimmed.match(/profiles\.php\D+(\d+)/i);
  if (match) {
    const value = Number(match[1]);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  return null;
}
