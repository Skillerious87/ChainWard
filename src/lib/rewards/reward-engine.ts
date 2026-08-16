import type {
  CalculatedRewardLine,
  MemberContributionInput,
  MemberRewardCalculation,
  RewardCalculation,
  RewardCoverageGap,
  RewardCoverageReport,
  RewardSchemeInput,
  RewardTierInput,
  TierValidationIssue,
} from "./types";

export class InvalidRewardSchemeError extends Error {
  constructor(readonly issues: readonly TierValidationIssue[]) {
    super("The reward scheme contains invalid or overlapping tiers.");
    this.name = "InvalidRewardSchemeError";
  }
}

export function validateRewardTiers(
  tiers: readonly RewardTierInput[],
): TierValidationIssue[] {
  const issues: TierValidationIssue[] = [];
  const enabled = tiers
    .filter((tier) => tier.enabled)
    .toSorted((left, right) => left.minimumHits - right.minimumHits);

  for (const tier of enabled) {
    if (!Number.isInteger(tier.minimumHits) || tier.minimumHits < 0) {
      issues.push({
        code: "INVALID_MINIMUM",
        message: `${tier.label} must start at a non-negative whole number.`,
        tierIds: [tier.id],
      });
    }

    if (
      tier.maximumHits !== null &&
      (!Number.isInteger(tier.maximumHits) || tier.maximumHits < tier.minimumHits)
    ) {
      issues.push({
        code: "INVALID_MAXIMUM",
        message: `${tier.label} must end at or above its minimum.`,
        tierIds: [tier.id],
      });
    }

    const seenRewards = new Set<string>();
    for (const reward of tier.rewards) {
      if (!Number.isFinite(reward.amount) || reward.amount < 0) {
        issues.push({
          code: "NEGATIVE_REWARD",
          message: `${tier.label} has an invalid ${reward.reward.name} amount.`,
          tierIds: [tier.id],
        });
      }
      if (seenRewards.has(reward.reward.id)) {
        issues.push({
          code: "DUPLICATE_REWARD",
          message: `${tier.label} includes ${reward.reward.name} more than once.`,
          tierIds: [tier.id],
        });
      }
      seenRewards.add(reward.reward.id);
    }
  }

  const unlimited = enabled.filter((tier) => tier.maximumHits === null);
  if (unlimited.length > 1) {
    issues.push({
      code: "MULTIPLE_UNLIMITED_RANGES",
      message: "Only one enabled tier can have an unlimited upper range.",
      tierIds: unlimited.map((tier) => tier.id),
    });
  }

  for (let index = 1; index < enabled.length; index += 1) {
    const previous = enabled[index - 1];
    const current = enabled[index];
    if (!previous || !current) continue;

    const previousMaximum = previous.maximumHits ?? Number.POSITIVE_INFINITY;
    if (current.minimumHits <= previousMaximum) {
      issues.push({
        code: "OVERLAPPING_RANGE",
        message: `${previous.label} overlaps ${current.label}.`,
        tierIds: [previous.id, current.id],
      });
    }
  }

  return issues;
}

/**
 * Reports the hit counts no enabled tier claims. Overlaps and invalid bounds
 * are handled by `validateRewardTiers`; this describes the opposite failure,
 * where a member finishes a chain inside a range that pays nothing at all.
 */
export function analyzeRewardCoverage(
  tiers: readonly RewardTierInput[],
): RewardCoverageReport {
  const enabled = tiers
    .filter((tier) => tier.enabled && Number.isInteger(tier.minimumHits) && tier.minimumHits >= 0)
    .toSorted((left, right) => left.minimumHits - right.minimumHits);

  if (enabled.length === 0) {
    return { enabledTierCount: 0, gaps: [{ fromHits: 0, toHits: null }], coversUnlimited: false, lowestCoveredHits: null, highestCoveredHits: null };
  }

  const gaps: RewardCoverageGap[] = [];
  let nextUncovered = 0;
  let coversUnlimited = false;
  let highestCoveredHits: number | null = null;

  for (const tier of enabled) {
    if (coversUnlimited) break;
    if (tier.minimumHits > nextUncovered) {
      gaps.push({ fromHits: nextUncovered, toHits: tier.minimumHits - 1 });
    }
    if (tier.maximumHits === null) {
      coversUnlimited = true;
      highestCoveredHits = null;
      break;
    }
    const upper = Math.max(tier.minimumHits, tier.maximumHits);
    nextUncovered = Math.max(nextUncovered, upper + 1);
    highestCoveredHits = upper;
  }

  if (!coversUnlimited) gaps.push({ fromHits: nextUncovered, toHits: null });

  return {
    enabledTierCount: enabled.length,
    gaps,
    coversUnlimited,
    lowestCoveredHits: enabled[0]?.minimumHits ?? null,
    highestCoveredHits,
  };
}

export function calculateRewards(
  contributions: readonly MemberContributionInput[],
  scheme: RewardSchemeInput,
): RewardCalculation {
  const issues = validateRewardTiers(scheme.tiers);
  if (issues.length > 0) {
    throw new InvalidRewardSchemeError(issues);
  }

  const tiers = scheme.tiers
    .filter((tier) => tier.enabled)
    .toSorted((left, right) => left.minimumHits - right.minimumHits);
  const liabilityTotals: Record<string, CalculatedRewardLine> = {};

  const members = contributions.map<MemberRewardCalculation>((contribution) => {
    if (!Number.isInteger(contribution.hits) || contribution.hits < 0) {
      throw new RangeError(`Hits must be a non-negative integer for ${contribution.memberName}.`);
    }

    const tier = findTier(tiers, contribution.hits);
    const rewards = (tier?.rewards ?? []).map<CalculatedRewardLine>((line) => ({
      rewardDefinitionId: line.reward.id,
      name: line.reward.name,
      displayUnit: line.reward.displayUnit,
      amount: line.amount,
    }));

    for (const reward of rewards) {
      const total = liabilityTotals[reward.rewardDefinitionId];
      liabilityTotals[reward.rewardDefinitionId] = total
        ? { ...total, amount: total.amount + reward.amount }
        : { ...reward };
    }

    return {
      tornUserId: contribution.tornUserId,
      memberName: contribution.memberName,
      hits: contribution.hits,
      tierId: tier?.id ?? null,
      tierLabel: tier?.label ?? null,
      rewards,
    };
  });

  return {
    scheme: { id: scheme.id, name: scheme.name, version: scheme.version },
    members,
    liabilityTotals,
  };
}

export function createRewardSnapshot(
  chainId: string,
  calculation: RewardCalculation,
  calculatedAt: Date,
) {
  return {
    chainId,
    calculatedAt: calculatedAt.toISOString(),
    scheme: { ...calculation.scheme },
    members: calculation.members.map((member) => ({
      ...member,
      rewards: member.rewards.map((reward) => ({ ...reward })),
    })),
    liabilityTotals: Object.fromEntries(
      Object.entries(calculation.liabilityTotals).map(([key, reward]) => [
        key,
        { ...reward },
      ]),
    ),
  };
}

function findTier(
  tiers: readonly RewardTierInput[],
  hits: number,
): RewardTierInput | undefined {
  return tiers.find(
    (tier) =>
      hits >= tier.minimumHits &&
      (tier.maximumHits === null || hits <= tier.maximumHits),
  );
}
