import Image from "next/image";

interface RewardAmountProps {
  amount: number;
  unit: string;
  detail?: string;
  paid?: boolean;
  size?: "compact" | "table" | "summary";
  artwork?: "quantity" | "liability";
}

const rewardImageRoot = "/images/rewards";

export function RewardAmount({ amount, unit, detail, paid = false, size = "table", artwork = "quantity" }: RewardAmountProps) {
  const formatted = amount.toLocaleString();
  const xanax = isXanaxUnit(unit);
  const artworkSrc = xanax ? getXanaxRewardImage(amount, artwork) : null;
  const noReward = xanax && artwork === "quantity" && Number.isFinite(amount) && amount <= 0;
  const reserveArtworkRail = xanax && (Boolean(artworkSrc) || size !== "summary");
  return <span className={`reward-amount reward-amount--${size}${xanax ? " reward-amount--xanax" : ""}${reserveArtworkRail ? " reward-amount--with-art" : ""}${artwork === "liability" && artworkSrc ? " reward-amount--liability" : ""}${noReward ? " reward-amount--none" : ""}${paid ? " reward-amount--paid" : ""}`} aria-label={`${formatted} ${unit}${detail ? `, ${detail}` : ""}${paid ? ", paid" : ""}`}>
    {reserveArtworkRail && <span className={`reward-amount__art${artworkSrc ? "" : " reward-amount__art--empty"}`} aria-hidden="true">{artworkSrc && <Image src={artworkSrc} alt="" fill unoptimized sizes="(max-width: 700px) 42px, 64px" />}</span>}
    <span className="reward-amount__copy">
      <span className="reward-amount__headline"><strong>{formatted}</strong><span>{unit}</span></span>
      {detail && <small>{detail}</small>}
    </span>
  </span>;
}

export function isXanaxUnit(unit: string | null | undefined): boolean {
  return Boolean(unit?.trim().toLowerCase().includes("xanax"));
}

export function getXanaxRewardImage(amount: number, artwork: "quantity" | "liability" = "quantity"): string | null {
  if (artwork === "liability") return `${rewardImageRoot}/xanax-reward-box.png`;
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (amount <= 1) return `${rewardImageRoot}/xanax-reward-one-pill.png`;
  if (amount <= 3) return `${rewardImageRoot}/xanax-reward.png`;
  return `${rewardImageRoot}/xanax-reward-box.png`;
}
