import { z } from "zod";

const stat = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const battleStatsSchema = z.object({ strength: stat, defense: stat, speed: stat, dexterity: stat, total: stat });
// Torn API v2 has shipped `/user/battlestats` as both a flat number per stat and
// as `{ value: number }`, and may add more keys. Keep the envelope permissive and
// normalise the numbers in the data service so a shape change degrades to a clear
// message instead of a validation crash.
export const battleStatsResponseSchema = z.object({
  battlestats: z.record(z.string(), z.unknown()),
}).loose();

const timestamp = z.number().int().nonnegative();
const optionalTimestamp = timestamp.nullable().optional().catch(null);
// `.loose()` throughout: Torn keeps adding, renaming and removing fields on the
// v2 OC payload (empty-slot CPR was zeroed and `position_id` removed in June
// 2026) and an unmodelled or drifted key must never invalidate a row.
// `status` is a free string on purpose — its casing has differed between
// endpoints and releases; callers normalise it with `normStatus`.
export const crimeSlotSchema = z.object({
  position: z.string().default(""),
  position_info: z.object({
    id: z.union([z.string(), z.number()]).optional(),
    label: z.string().default(""),
    number: z.number().optional(),
  }).loose().default({ label: "" }),
  user: z.object({
    id: z.number().int().positive(),
    name: z.string().optional(),
    joined_at: optionalTimestamp,
    progress: z.number().optional(),
    outcome: z.string().optional(),
  }).loose().nullable().catch(null),
  // 0 and null both mean "no usable evidence" post June 2026.
  checkpoint_pass_rate: z.number().nullable().catch(null),
  item_requirement: z.object({
    id: z.number().int().positive(),
    is_available: z.boolean().optional(),
    is_reusable: z.boolean().optional(),
  }).loose().nullable().catch(null),
}).loose();

export const crimeRewardsSchema = z.object({
  money: z.number().optional(),
  respect: z.number().optional(),
  scope: z.number().optional(),
  items: z.array(z.object({ id: z.number(), quantity: z.number() }).loose()).optional(),
  payout: z.object({
    type: z.string().optional(),
    percentage: z.number().optional(),
    paid_by: z.number().optional(),
    paid_at: optionalTimestamp,
  }).loose().nullable().optional(),
}).loose();

export const crimeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  difficulty: z.number().int().nonnegative().catch(0),
  status: z.string().default(""),
  created_at: optionalTimestamp,
  planning_at: optionalTimestamp,
  expired_at: optionalTimestamp,
  executed_at: optionalTimestamp,
  ready_at: optionalTimestamp,
  participants: z.number().int().nonnegative().optional(),
  pass_rate: z.number().optional(),
  planned_by: z.object({ id: z.number(), name: z.string().optional() }).loose().nullable().optional(),
  initiated_by: z.object({ id: z.number(), name: z.string().optional() }).loose().nullable().optional(),
  rewards: crimeRewardsSchema.nullable().optional(),
  slots: z.array(crimeSlotSchema).default([]),
}).loose();

export const crimesResponseSchema = z.object({
  crimes: z.array(z.unknown()).default([]),
  _metadata: z.object({ links: z.object({ next: z.string().nullable().optional() }).loose().optional() }).loose().optional(),
}).loose();

/** `/user/organizedcrimes` — the member's own view of joinable (Recruiting)
 *  crimes; still carries the key owner's real CPR on empty slots. */
export const myOrganizedCrimesResponseSchema = z.object({
  organizedcrimes: z.array(z.unknown()).default([]),
}).loose();

export const roleObservationSchema = z.object({
  crimeId: z.number().int().positive(),
  crimeName: z.string(),
  difficulty: z.number().int().nonnegative(),
  positionId: z.string().default(""),
  positionLabel: z.string(),
  passRate: z.number().min(0).max(100),
  observedAt: z.string().datetime(),
});

export const memberIntelSchema = z.object({
  factionId: z.number().int().positive(), tornUserId: z.number().int().positive(),
  stats: battleStatsSchema, statsAt: z.string().datetime(),
  roles: z.array(roleObservationSchema).max(2000),
  rolesMessage: z.string(), source: z.enum(["torn", "offline"]),
});

export const DEFAULT_MINIMUM_CPR = 70;
export const ocReviewSettingsSchema = z.object({
  minimumCpr: z.number().int().min(0).max(100),
});
/** Per-member sharing preference. `autoShare` re-pushes the member's own stats
 *  whenever they open the workspace and the last snapshot is stale. */
export const ocSharePreferenceSchema = z.object({
  autoShare: z.boolean(),
  lastAutoShareAt: z.string().datetime().nullable().optional(),
});

export type BattleStats = z.infer<typeof battleStatsSchema>;
export type OrganizedCrime = z.infer<typeof crimeSchema>;
export type OrganizedCrimeSlot = z.infer<typeof crimeSlotSchema>;
export type CrimeRewards = z.infer<typeof crimeRewardsSchema>;
export type MemberIntel = z.infer<typeof memberIntelSchema>;
export type RoleObservation = z.infer<typeof roleObservationSchema>;
export type OcReviewSettings = z.infer<typeof ocReviewSettingsSchema>;
export type OcSharePreference = z.infer<typeof ocSharePreferenceSchema>;

export interface CrimeFeed { crimes: OrganizedCrime[]; available: boolean; complete: boolean; fetchedAt: string | null; message: string }

/* --- Derived intelligence (built by the data service, consumed by the UI) --- */

export type CprSource = "self-report" | "assigned" | "history";

export interface CapabilityEntry {
  roleKey: string;
  positionLabel: string;
  /** Best CPR seen for this member+role from any source. */
  bestCpr: number;
  /** Recency-weighted CPR (30-day half-life) across all observations. */
  weightedCpr: number;
  source: CprSource;
  observedAt: string;
  samples: number;
  /** 0..1 — grows with sample count and recency. */
  confidence: number;
}

export interface MemberRoleHistory {
  roleKey: string;
  positionLabel: string;
  crimeName: string;
  difficulty: number;
  count: number;
  wins: number;
  losses: number;
  avgCpr: number;
  bestCpr: number;
  lastAt: string;
}

export interface MemberOcProfile {
  tornUserId: number;
  ocCount: number;
  wins: number;
  losses: number;
  /** Bayesian-smoothed success rate (0..1) or null when there is no history. */
  successRate: number | null;
  lastOcAt: string | null;
  roles: MemberRoleHistory[];
}

export interface ScenarioStat {
  key: string;
  crimeName: string;
  difficulty: number;
  samples: number;
  successRate: number | null;
  medMoney: number | null;
  medRespect: number | null;
  medPayoutPct: number | null;
  medParticipants: number | null;
  perPlayerMoney: number | null;
}

export interface FactionOcHealth {
  windowDays: number;
  completedInWindow: number;
  successRate: number | null;
  medRespect: number | null;
  medMoney: number | null;
  /** difficulty -> { attempts, wins } within the window. */
  difficultyCoverage: Array<{ difficulty: number; attempts: number; wins: number }>;
  activeCount: number;
  needsFillingCount: number;
}

export interface SlotAssignment {
  positionLabel: string;
  positionKey: string;
  itemRequirementId: number | null;
  itemAvailable: boolean | null;
  assignee: { tornUserId: number; name: string } | null;
  cpr: number | null;
  weightedCpr: number | null;
  source: CprSource | null;
  meetsBaseline: boolean;
  alternates: Array<{ tornUserId: number; name: string; cpr: number; source: CprSource }>;
}

export interface CrimeFill {
  crimeId: number;
  crimeName: string;
  difficulty: number;
  status: string;
  readyAt: string | null;
  expiresAt: string | null;
  baseline: number;
  scenario: ScenarioStat | null;
  slots: SlotAssignment[];
  filled: number;
  open: number;
  gaps: number;
  estimatedSuccess: number | null;
  estimateBand: [number, number] | null;
  weakestSlot: string | null;
}
