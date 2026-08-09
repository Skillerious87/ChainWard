import type { RewardSchemeInput } from "./types";

const xanax = {
  id: "reward-xanax",
  name: "Xanax",
  displayUnit: "Xanax",
  kind: "item" as const,
  decimals: 0,
};

export const developmentRewardScheme: RewardSchemeInput = {
  id: "scheme-standard-v1",
  name: "Standard Chain",
  version: 1,
  tiers: [
    tier("tier-0-5", 0, 5, 0, "Below threshold", "Below payout threshold"),
    tier("tier-6-15", 6, 15, 1, "Entry", "Entry contribution"),
    tier("tier-16-25", 16, 25, 2, "Steady", "Steady performer"),
    tier("tier-26-35", 26, 35, 3, "Committed", "Committed runner"),
    tier("tier-36-45", 36, 45, 4, "High", "High contributor"),
    tier("tier-46-plus", 46, null, 5, "Top", "Top reward tier"),
  ],
};

function tier(
  id: string,
  minimumHits: number,
  maximumHits: number | null,
  amount: number,
  label: string,
  description: string,
) {
  return {
    id,
    minimumHits,
    maximumHits,
    label,
    description,
    position: minimumHits,
    enabled: true,
    rewards: [{ reward: xanax, amount }],
  };
}
