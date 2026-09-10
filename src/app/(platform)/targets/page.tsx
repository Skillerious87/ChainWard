import type { Metadata } from "next";
import { TargetsWorkspace } from "@/components/targets/targets-workspace";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { enrichWithFairFight, type FairFightInfo } from "@/lib/targets/ffscouter";
import { hasFfscouterKey } from "@/lib/targets/ffscouter-key-store";
import { readTargetList, targetsStorageAvailable } from "@/lib/targets/store";
import type { TargetList } from "@/lib/targets/types";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";
import { getWorkspaceTelemetry } from "@/lib/torn/telemetry-service";

export const metadata: Metadata = { title: "Targets" };

export default async function TargetsPage() {
  await requireLicensedPage();
  const [actor, connection, telemetry] = await Promise.all([
    getCurrentActor(),
    getConfiguredTornConnection(),
    getWorkspaceTelemetry(),
  ]);
  const factionId = connection?.factionId ?? null;
  const storageAvailable = targetsStorageAvailable();

  let list: TargetList = { entries: [], snapshots: {} };
  let fairFight: Record<string, FairFightInfo> = {};
  let ffscouterConfigured = false;

  // First paint renders straight from the last-stored snapshots — no Torn calls,
  // no database write. The client then keeps everything current through the
  // budgeted /api/targets/refresh loop (live poll + backlog catch-up). Any
  // transient database failure here degrades to an empty list the client
  // refills, never a global-error screen.
  if (factionId && connection && storageAvailable) {
    try {
      list = await readTargetList(factionId, actor.tornUserId);
    } catch {
      list = { entries: [], snapshots: {} };
    }
    // Fair Fight badges are a bonus — a failure here must never blank the list.
    try {
      const [ffMap, configured] = await Promise.all([
        list.entries.length > 0
          ? enrichWithFairFight(factionId, actor.tornUserId, list.entries.map((entry) => entry.tornUserId))
          : Promise.resolve(new Map()),
        hasFfscouterKey(factionId, actor.tornUserId),
      ]);
      fairFight = Object.fromEntries([...ffMap].map(([tornUserId, info]) => [String(tornUserId), info]));
      ffscouterConfigured = configured;
    } catch {
      /* leave FF unenriched; the client's next poll fills it in */
    }
  }

  // One server timestamp drives every "now"-relative label so the client's first
  // render matches this HTML exactly (no hydration text mismatch).
  const nowMs = new Date().getTime();

  return (
    <TargetsWorkspace
      entries={list.entries}
      snapshots={list.snapshots}
      errors={{}}
      source={list.entries.length > 0 ? "Torn API v2" : "Unavailable"}
      fetchedAt={null}
      nowMs={nowMs}
      connected={Boolean(factionId && connection)}
      storageAvailable={storageAvailable}
      chain={telemetry.chain}
      chainDataAgeMs={telemetry.dataAgeMs ?? 0}
      chainCheckedAt={telemetry.checkedAt}
      fairFight={fairFight}
      ffscouterConfigured={ffscouterConfigured}
    />
  );
}
