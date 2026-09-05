import { z } from "zod";

const stat = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const battleStatsSchema = z.object({ strength: stat, defense: stat, speed: stat, dexterity: stat, total: stat });
export const battleStatsResponseSchema = z.object({ battlestats: z.object({
  strength: z.object({ value: stat }), defense: z.object({ value: stat }),
  speed: z.object({ value: stat }), dexterity: z.object({ value: stat }), total: stat,
}) });
const timestamp = z.number().int().nonnegative();
// `.loose()` throughout: Torn keeps adding fields to the v2 OC payload and an
// unmodelled key must never invalidate a row. `crimesResponseSchema` only
// validates the envelope; each crime is parsed individually by the data service
// so one malformed row is dropped rather than failing the whole feed.
export const crimeSchema = z.object({
  id: z.number().int().positive(), name: z.string().min(1), difficulty: z.number().int().positive(),
  status: z.enum(["Recruiting", "Planning", "Successful", "Failure", "Expired"]),
  created_at: timestamp, expired_at: timestamp, executed_at: timestamp.nullable(), ready_at: timestamp.nullable(),
  slots: z.array(z.object({
    position: z.string(), position_info: z.object({ id: z.string().or(z.number().int()), label: z.string() }).loose(),
    user: z.object({ id: z.number().int().positive(), joined_at: timestamp }).loose().nullable(),
    checkpoint_pass_rate: z.number().min(0).max(100).nullable(),
    item_requirement: z.object({ id: z.number().int().positive(), is_available: z.boolean(), is_reusable: z.boolean() }).loose().nullable(),
  }).loose()),
}).loose();
export const crimesResponseSchema = z.object({
  crimes: z.array(z.unknown()),
  _metadata: z.object({ links: z.object({ next: z.string().nullable().optional() }).loose() }).loose(),
}).loose();
export const roleObservationSchema = z.object({
  crimeId: z.number().int().positive(), crimeName: z.string(), difficulty: z.number().int().positive(),
  positionId: z.string(), positionLabel: z.string(), passRate: z.number().min(0).max(100),
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
export type BattleStats = z.infer<typeof battleStatsSchema>;
export type OrganizedCrime = z.infer<typeof crimeSchema>;
export type MemberIntel = z.infer<typeof memberIntelSchema>;
export type RoleObservation = z.infer<typeof roleObservationSchema>;
export type OcReviewSettings = z.infer<typeof ocReviewSettingsSchema>;
export interface CrimeFeed { crimes: OrganizedCrime[]; available: boolean; complete: boolean; fetchedAt: string | null; message: string }
