import type { Metadata } from "next";
import { TargetsWorkspace } from "@/components/targets/targets-workspace";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { refreshTargets } from "@/lib/targets/data-service";
import { enrichWithFairFight, type FairFightInfo } from "@/lib/targets/ffscouter";
import { hasFfscouterKey } from "@/lib/targets/ffscouter-key-store";
import { mergeSnapshots, readTargetList, targetsStorageAvailable, writeTargetList } from "@/lib/targets/store";
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
  let errors: Record<number, string> = {};
  let source = "Unavailable";
  let fetchedAt: string | null = null;
  let fairFight: Record<string, FairFightInfo> = {};
  let ffscouterConfigured = false;

  if (factionId && connection && storageAvailable) {
    list = await readTargetList(factionId, actor.tornUserId);
    if (list.entries.length > 0) {
      // First paint only needs the most-in-need handful up to date; the client
      // then drains the rest through the budgeted /api/targets/refresh loop.
      const refresh = await refreshTargets(list.entries, list.snapshots, { budget: 24 });
      errors = refresh.errors;
      source = refresh.source;
      fetchedAt = refresh.fetchedAt;
      if (refresh.snapshots.length > 0) {
        list = mergeSnapshots(list, refresh.snapshots);
        await writeTargetList(
          { id: factionId, name: connection.factionName ?? "", tag: connection.factionTag ?? "" },
          actor.tornUserId,
          list,
        ).catch(() => undefined);
      }
      const [ffMap, configured] = await Promise.all([
        enrichWithFairFight(factionId, actor.tornUserId, list.entries.map((entry) => entry.tornUserId)),
        hasFfscouterKey(factionId, actor.tornUserId),
      ]);
      fairFight = Object.fromEntries([...ffMap].map(([tornUserId, info]) => [String(tornUserId), info]));
      ffscouterConfigured = configured;
    } else {
      ffscouterConfigured = await hasFfscouterKey(factionId, actor.tornUserId);
    }
  }

  // One server timestamp drives every "now"-relative label so the client's first
  // render matches this HTML exactly (no hydration text mismatch).
  const nowMs = new Date().getTime();

  return (
    <TargetsWorkspace
      entries={list.entries}
      snapshots={list.snapshots}
      errors={errors}
      source={source}
      fetchedAt={fetchedAt}
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
