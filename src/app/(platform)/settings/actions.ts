"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { requirePlatformOwner } from "@/lib/auth/platform-owner";
import { localTestingEnabled } from "@/lib/data/local-database";
import { clearLocalFactionLicensing, grantLocalTestLicense } from "@/lib/licensing/local-license-store";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export interface LicenceTestResult {
  ok: boolean;
  message: string;
}

/**
 * Three independent conditions gate these controls, because a way to grant
 * yourself access is exactly what a paywall must not ship with:
 *
 *  - never in a production build,
 *  - only while local test mode is switched on by the dev script,
 *  - only for the verified platform owner.
 *
 * They also refuse to run against PostgreSQL, so a shared deployment cannot be
 * altered even if the first three were somehow satisfied.
 */
async function requireLicenceTestContext() {
  if (process.env.NODE_ENV === "production") throw new Error("Licence testing controls are disabled in production builds.");
  if (!localTestingEnabled()) throw new Error("Start the workspace with npm run dev:offline to use licence testing controls.");
  if (process.env.DATABASE_URL?.trim()) throw new Error("Licence testing controls only operate on the local test database.");
  const actor = await getCurrentActor();
  requirePlatformOwner(actor);
  const telemetry = await getWorkspaceTelemetry();
  if (telemetry.source !== "live" || !telemetry.faction) throw new Error("Connect a verified faction before changing its licence state.");
  return { actor, faction: telemetry.faction };
}

function revalidateWorkspace(): void {
  for (const path of ["/settings", "/dashboard", "/unlock", "/rewards", "/live-chain", "/chains", "/members", "/faction", "/payouts", "/analytics", "/admin"]) {
    revalidatePath(path);
  }
}

/** Removes the faction's licence so the locked workspace can be reviewed. */
export async function lockWorkspaceForTesting(): Promise<LicenceTestResult> {
  try {
    const { actor, faction } = await requireLicenceTestContext();
    clearLocalFactionLicensing(faction.id, actor);
    revalidateWorkspace();
    return { ok: true, message: `${faction.name} now has no licence. Every gated screen should redirect to the unlock workspace.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The licence state could not be changed." };
  }
}

/** Restores a lifetime licence after a locked-state review. */
export async function unlockWorkspaceForTesting(): Promise<LicenceTestResult> {
  try {
    const { actor, faction } = await requireLicenceTestContext();
    const reference = grantLocalTestLicense(faction.id, { id: faction.id, name: faction.name, tag: faction.tag }, actor);
    revalidateWorkspace();
    return { ok: true, message: `${faction.name} has lifetime access again under test reference ${reference}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The licence state could not be changed." };
  }
}
