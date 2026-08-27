import "server-only";

import { cache } from "react";
import { getPayoutReverts } from "@/lib/rewards/chain-settlement";
import { getPayoutLedger } from "@/lib/rewards/payout-store";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

/**
 * One request-scoped payout snapshot shared by the parent layout and child
 * pages. React cache avoids re-reading persistence when both need the same
 * counts and records during a single render.
 */
export const getPayoutWorkspace = cache(async () => {
  const [telemetry, roster] = await Promise.all([getWorkspaceTelemetry(), getFactionRoster()]);
  const factionId = telemetry.faction?.id ?? null;
  const knownNames = Object.fromEntries(roster.data.map((member) => [member.tornId, member.name]));
  const [ledger, corrections] = await Promise.all([
    getPayoutLedger(factionId, knownNames),
    factionId ? getPayoutReverts(factionId, 100) : Promise.resolve([]),
  ]);

  return {
    corrections,
    ledger,
    recipientCount: new Set(ledger.entries.filter((entry) => entry.amount > 0).map((entry) => entry.tornUserId)).size,
  };
});
