import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getXanaxRewardImage, RewardAmount } from "./reward-amount";

describe("RewardAmount", () => {
  it.each([
    [0, "/images/rewards/xanax-reward-one-pill.png"],
    [1, "/images/rewards/xanax-reward-one-pill.png"],
    [2, "/images/rewards/xanax-reward.png"],
    [3, "/images/rewards/xanax-reward.png"],
    [4, "/images/rewards/xanax-reward-box.png"],
  ])("selects the correct committed artwork for %s Xanax", (amount, expected) => {
    expect(getXanaxRewardImage(amount)).toBe(expected);
  });

  it("always uses the box artwork for a liability", () => {
    for (const amount of [0, 1, 3, 22]) {
      expect(getXanaxRewardImage(amount, "liability")).toBe("/images/rewards/xanax-reward-box.png");
    }
    const html = renderToStaticMarkup(<RewardAmount amount={1} unit="Xanax" artwork="liability" />);

    expect(html).toContain("reward-amount--liability");
    expect(html).toContain('src="/images/rewards/xanax-reward-box.png"');
    expect(html).not.toContain("/_next/image");
  });

  it("keeps the Xanax quantity, unit, and tier in stable layout regions", () => {
    const html = renderToStaticMarkup(<RewardAmount amount={5} unit="Xanax" detail="Top tier" paid />);

    expect(html).toContain("reward-amount--xanax");
    expect(html).toContain("reward-amount__art");
    expect(html).toContain("reward-amount__headline");
    expect(html).toContain("<strong>5</strong><span>Xanax</span>");
    expect(html).toContain("<small>Top tier</small>");
    expect(html).toContain('aria-label="5 Xanax, Top tier, paid"');
  });

  it("does not show the Xanax artwork for other reward units", () => {
    const html = renderToStaticMarkup(<RewardAmount amount={250_000} unit="Points" />);

    expect(html).not.toContain("reward-amount__art");
    expect(html).not.toContain("xanax-reward.png");
  });

  it("strikes through the single-pill artwork for a member with no reward", () => {
    const html = renderToStaticMarkup(<RewardAmount amount={0} unit="Xanax" detail="Below threshold" />);

    expect(html).toContain("reward-amount--none");
    expect(html).toContain('src="/images/rewards/xanax-reward-one-pill.png"');
  });
});
