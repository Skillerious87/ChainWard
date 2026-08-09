import type { Metadata } from "next";
import { RewardSchemesManager } from "@/components/rewards/reward-schemes-manager";
import { getRewardWorkspace } from "@/lib/rewards/reward-store";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const metadata: Metadata = { title: "Reward Schemes" };

export default async function RewardsPage() {
  const telemetry = await getWorkspaceTelemetry();
  const workspace = await getRewardWorkspace(telemetry.faction?.id ?? null);
  return <RewardSchemesManager key={workspace.revision} workspace={workspace} />;
}
