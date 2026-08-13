import { AuthorizationError } from "@/lib/auth/authorization";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { buildMemberActivityAlert, type MemberActivityMonitorSnapshot } from "@/lib/members/member-activity-intelligence";
import { getMemberActivityWorkspace } from "@/lib/members/member-activity-store";
import { consumeGlobalRateLimit } from "@/lib/security/rate-limit";
import { getFactionRoster } from "@/lib/torn/workspace-data-service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { actor, faction } = await requireFactionPermission("members:manage");
    const rateLimit = consumeGlobalRateLimit(`member-activity-monitor:${actor.tornUserId}`, { limit: 30, windowMs: 60 * 60_000 });
    if (!rateLimit.allowed) {
      return Response.json(
        { error: "Member monitoring is checking too frequently. Wait before trying again." },
        { status: 429, headers: { "cache-control": "no-store", "retry-after": String(rateLimit.retryAfterSeconds) } },
      );
    }
    const [roster, workspace] = await Promise.all([
      getFactionRoster(),
      getMemberActivityWorkspace(faction.id),
    ]);
    if (!roster.available) {
      return Response.json(
        { error: roster.message },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    const snapshot: MemberActivityMonitorSnapshot = {
      factionId: faction.id,
      factionName: faction.name,
      ...buildMemberActivityAlert(roster.data, workspace, roster.checkedAt),
    };
    return Response.json(snapshot, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (error) {
    const authorizationFailure = error instanceof AuthorizationError;
    return Response.json(
      { error: error instanceof Error ? error.message : "Member activity monitoring is unavailable." },
      { status: authorizationFailure ? 403 : 500, headers: { "cache-control": "no-store" } },
    );
  }
}
