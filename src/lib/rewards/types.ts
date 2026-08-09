export type RewardKind = "item" | "currency" | "points" | "custom";

export interface RewardDefinitionInput {
  id: string;
  name: string;
  displayUnit: string;
  kind: RewardKind;
  decimals: number;
}

export interface TierRewardInput {
  reward: RewardDefinitionInput;
  amount: number;
}

export interface RewardTierInput {
  id: string;
  minimumHits: number;
  maximumHits: number | null;
  label: string;
  description?: string;
  position: number;
  enabled: boolean;
  rewards: readonly TierRewardInput[];
}

export interface RewardSchemeInput {
  id: string;
  name: string;
  version: number;
  tiers: readonly RewardTierInput[];
}

export interface MemberContributionInput {
  tornUserId: number;
  memberName: string;
  hits: number;
}

export interface CalculatedRewardLine {
  rewardDefinitionId: string;
  name: string;
  displayUnit: string;
  amount: number;
}

export interface MemberRewardCalculation {
  tornUserId: number;
  memberName: string;
  hits: number;
  tierId: string | null;
  tierLabel: string | null;
  rewards: CalculatedRewardLine[];
}

export interface RewardCalculation {
  scheme: {
    id: string;
    name: string;
    version: number;
  };
  members: MemberRewardCalculation[];
  liabilityTotals: Record<string, CalculatedRewardLine>;
}

export type TierValidationCode =
  | "INVALID_MINIMUM"
  | "INVALID_MAXIMUM"
  | "OVERLAPPING_RANGE"
  | "MULTIPLE_UNLIMITED_RANGES"
  | "NEGATIVE_REWARD"
  | "DUPLICATE_REWARD";

export interface TierValidationIssue {
  code: TierValidationCode;
  message: string;
  tierIds: string[];
}
