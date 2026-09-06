import type { Metadata } from "next";
import { TargetsWorkspace } from "@/components/targets/targets-workspace";
import { getCurrentActor } from "@/lib/auth/current-actor";
import { requireLicensedPage } from "@/lib/licensing/guards";
import { refreshTargets } from "@/lib/targets/data-service";
import { mergeSnapshots, readTargetList, targetsStorageAvailable, writeTargetList } from "@/lib/targets/store";
import type { TargetList } from "@/lib/targets/types";
import { getConfiguredTornConnection } from "@/lib/torn/server-client";

export const metadata: Metadata = { title: "Targets" };

export default async function TargetsPage() {
  await requireLicensedPage();
  const [actor, connection] = await Promise.all([getCurrentActor(), getConfiguredTornConnection()]);
  const factionId = connection?.factionId ?? null;
  const storageAvailable = targetsStorageAvailable();

  let list: TargetList = { entries: [], snapshots: {} };
  let errors: Record<number, string> = {};
  let source = "Unavailable";
  let fetchedAt: string | null = null;

  if (factionId && connection && storageAvailable) {
    list = await readTargetList(factionId, actor.tornUserId);
    if (list.entries.length > 0) {
      const refresh = await refreshTargets(list.entries, list.snapshots);
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
    />
  );
}
