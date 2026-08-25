import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContributionTable } from "./contribution-table";

const member = {
  rank: 1,
  name: "Chain Tester",
  tornId: 123456,
  hits: 26,
  contribution: 28.9,
  respect: 113.04,
  status: "Okay",
};

describe("ContributionTable rewards", () => {
  it("renders each calculated member reward", () => {
    const html = renderToStaticMarkup(<ContributionTable
      members={[member]}
      rewards={{ [member.tornId]: { amount: 5, tierLabel: "Vanguard" } }}
      rewardUnit="Xanax"
      showRewards
    />);

    expect(html).toContain("Member reward");
    expect(html).toContain("5 Xanax, Vanguard");
  });

  it("keeps the reward column visible when calculation is unavailable", () => {
    const html = renderToStaticMarkup(<ContributionTable
      members={[member]}
      showRewards
      rewardMessage="Choose a default reward scheme before calculating this chain."
    />);

    expect(html).toContain("Member rewards are not calculated yet");
    expect(html).toContain("Not calculated");
    expect(html).toContain('href="/rewards"');
  });
});
