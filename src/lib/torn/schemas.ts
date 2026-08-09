import { z } from "zod";

const unixTimestamp = z.number().int().nonnegative();

export const tornErrorSchema = z.object({
  error: z.object({
    code: z.number().int(),
    error: z.string(),
  }),
});

export const keyInfoResponseSchema = z.object({
  info: z.object({
    selections: z.object({
      faction: z.array(z.string()),
      user: z.array(z.string()),
      key: z.array(z.string()),
    }).loose(),
    access: z.object({
      level: z.number().int(),
      type: z.enum([
        "Custom",
        "Public Only",
        "Minimal Access",
        "Limited Access",
        "Full Access",
      ]),
      faction: z.boolean(),
      company: z.boolean(),
    }).loose(),
    user: z.object({
      id: z.number().int().positive(),
      faction_id: z.number().int().positive().nullable(),
      company_id: z.number().int().positive().nullable(),
    }),
  }),
});

export const userBasicResponseSchema = z.object({
  profile: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    level: z.number().int().nonnegative(),
    gender: z.string(),
    status: z.object({
      description: z.string(),
      details: z.string().nullable(),
      state: z.string(),
      until: unixTimestamp.nullable(),
      color: z.string(),
    }).loose(),
  }),
});

export const factionBasicResponseSchema = z.object({
  basic: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    tag: z.string(),
    tag_image: z.string(),
    banner_image: z.string(),
    leader_id: z.number().int().positive(),
    co_leader_id: z.number().int().nonnegative(),
    respect: z.number().int().nonnegative(),
    days_old: z.number().int().nonnegative(),
    capacity: z.number().int().nonnegative(),
    members: z.number().int().nonnegative(),
    is_enlisted: z.boolean().nullable(),
    rank: z.unknown(),
    best_chain: z.number().int().nonnegative(),
    note: z.string().optional(),
  }),
});

export const ongoingChainResponseSchema = z.object({
  chain: z.object({
    id: z.number().int().nonnegative(),
    current: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
    timeout: z.number().int().nonnegative(),
    modifier: z.number(),
    cooldown: unixTimestamp,
    start: unixTimestamp,
    end: unixTimestamp,
  }),
});

export const chainsResponseSchema = z.object({
  chains: z.array(
    z.object({
      id: z.number().int().nonnegative(),
      chain: z.number().int().nonnegative(),
      respect: z.number(),
      start: unixTimestamp,
      end: unixTimestamp,
    }),
  ),
  _metadata: z.object({ links: z.unknown() }),
});

const attackBreakdownSchema = z.object({
  total: z.number().int().nonnegative(),
  leave: z.number().int().nonnegative(),
  mug: z.number().int().nonnegative(),
  hospitalize: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  retaliations: z.number().int().nonnegative(),
  overseas: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  escapes: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  war: z.number().int().nonnegative(),
  bonuses: z.number().int().nonnegative(),
});

export const chainReportResponseSchema = z.object({
  chainreport: z.object({
    id: z.number().int().nonnegative(),
    faction_id: z.number().int().positive(),
    start: unixTimestamp,
    end: unixTimestamp,
    details: z.object({
      chain: z.number().int().nonnegative(),
      respect: z.number(),
      members: z.number().int().nonnegative(),
      targets: z.number().int().nonnegative(),
      war: z.number().int().nonnegative(),
      best: z.number(),
      leave: z.number().int().nonnegative(),
      mug: z.number().int().nonnegative(),
      hospitalize: z.number().int().nonnegative(),
      assists: z.number().int().nonnegative(),
      retaliations: z.number().int().nonnegative(),
      overseas: z.number().int().nonnegative(),
      draws: z.number().int().nonnegative(),
      escapes: z.number().int().nonnegative(),
      losses: z.number().int().nonnegative(),
    }),
    bonuses: z.array(
      z.object({
        attacker_id: z.number().int().positive(),
        defender_id: z.number().int().positive(),
        chain: z.number().int().nonnegative(),
        respect: z.number().int().nonnegative(),
      }),
    ),
    attackers: z.array(
      z.object({
        id: z.number().int().positive(),
        respect: z.object({
          total: z.number(),
          average: z.number(),
          best: z.number(),
        }),
        attacks: attackBreakdownSchema,
      }),
    ),
    non_attackers: z.array(z.number().int().positive()),
  }),
});

export const factionMembersResponseSchema = z.object({
  members: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      position: z.string(),
      level: z.number().int().nonnegative(),
      days_in_faction: z.number().int().nonnegative(),
      is_revivable: z.boolean(),
      is_on_wall: z.boolean(),
      is_in_oc: z.boolean(),
      has_early_discharge: z.boolean(),
      last_action: z.object({
        status: z.string(),
        timestamp: unixTimestamp,
        relative: z.string(),
      }),
      status: z.object({
        description: z.string(),
        details: z.string().nullable(),
        state: z.string(),
        until: unixTimestamp.nullable(),
        color: z.string(),
      }).loose(),
      revive_setting: z.string(),
    }),
  ),
});

export type KeyInfoResponse = z.infer<typeof keyInfoResponseSchema>;
export type UserBasicResponse = z.infer<typeof userBasicResponseSchema>;
export type FactionBasicResponse = z.infer<typeof factionBasicResponseSchema>;
export type OngoingChainResponse = z.infer<typeof ongoingChainResponseSchema>;
export type ChainsResponse = z.infer<typeof chainsResponseSchema>;
export type ChainReportResponse = z.infer<typeof chainReportResponseSchema>;
export type FactionMembersResponse = z.infer<typeof factionMembersResponseSchema>;
