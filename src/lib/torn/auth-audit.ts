import "server-only";

export interface AuthAuditEvent {
  tornFactionId: number;
  tornUserId?: number;
  keyFingerprint?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Mirrors every other `AuditLog` writer in this codebase (e.g.
 * `faction-access-store.ts`) - Postgres-only, matching local mode's existing
 * scope, since the local sqlite backend has no audit table at all. A miss on
 * the read-only Faction/User lookup is not an error: audit logging must never
 * create business rows as a side effect of observing one, and the raw Torn
 * IDs in `metadata` keep the entry useful either way.
 */
export async function recordAuthEvent(action: string, event: AuthAuditEvent): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) return;
  try {
    const { db } = await import("@/lib/db");
    const [faction, user] = await Promise.all([
      db.faction.findUnique({ where: { tornFactionId: event.tornFactionId }, select: { id: true } }),
      event.tornUserId ? db.user.findUnique({ where: { tornUserId: event.tornUserId }, select: { id: true } }) : Promise.resolve(null),
    ]);
    await db.auditLog.create({
      data: {
        factionId: faction?.id ?? null,
        actorId: user?.id ?? null,
        action,
        entityType: event.entityType ?? "AuthSession",
        entityId: event.entityId ?? null,
        metadata: {
          tornFactionId: event.tornFactionId,
          ...(event.tornUserId !== undefined ? { tornUserId: event.tornUserId } : {}),
          ...(event.keyFingerprint ? { keyFingerprint: event.keyFingerprint } : {}),
          ...(event.metadata ?? {}),
        },
      },
    });
  } catch {
    // Auditing is an observer, never a gate - a failed write must not block
    // or fail the sign-in/enrollment/removal it was trying to record.
  }
}
