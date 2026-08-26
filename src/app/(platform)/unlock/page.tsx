import type { Metadata } from "next";
import { UnlockWorkspace } from "@/components/licensing/unlock-workspace";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { getFactionAccessAssignment } from "@/lib/auth/faction-access-store";
import { isPlatformOwner } from "@/lib/auth/platform-owner";
import { getFactionAccessSummary } from "@/lib/licensing/faction-access";
import { createPaymentReference } from "@/lib/licensing/pricing";
import { getLicenseRenewalNotice } from "@/lib/licensing/renewal";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const metadata: Metadata = { title: "Unlock Chainward" };

export default async function UnlockPage() {
  const [telemetry, actor] = await Promise.all([getWorkspaceTelemetry(), getCurrentActor()]);
  const access = await getFactionAccessSummary(telemetry.faction?.id ?? null);
  const factionId = telemetry.faction?.id ?? null;
  const owner = isPlatformOwner(actor);
  const assignment = owner ? null : await getFactionAccessAssignment(factionId, actor.tornUserId);
  const workspaceAuthorized = access.state === "active" && (owner || Boolean(assignment));
  const renewalOpen = access.state === "active" && getLicenseRenewalNotice(access.expiresAt).renewalOpen;
  const paymentReference = factionId && (access.state === "inactive" || (workspaceAuthorized && renewalOpen && !access.renewalRequest)) ? createPaymentReference(factionId) : null;
  return <UnlockWorkspace factionId={factionId} factionName={telemetry.faction?.name ?? null} access={access} workspaceAuthorized={workspaceAuthorized} paymentReference={paymentReference} />;
}
