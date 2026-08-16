import type { Metadata } from "next";
import { RewardSchemesManager } from "@/components/rewards/reward-schemes-manager";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { getRewardWorkspace } from "@/lib/rewards/reward-store";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const metadata: Metadata = { title: "Reward Schemes" };

export default async function RewardsPage() {
  await requireLicensedPage();
  const telemetry = await getWorkspaceTelemetry();
  const workspace = await getRewardWorkspace(telemetry.faction?.id ?? null);
  // The manager reconciles its own draft against `workspace.revision`, which
  // keeps the operator's selection and scroll position across a save.
  return <RewardSchemesManager workspace={workspace} />;
}
