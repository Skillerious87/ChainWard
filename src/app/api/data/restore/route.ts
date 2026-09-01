import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { localDatabaseExists, openLocalDatabase } from "@/lib/data/local-database";
import { localBackupCompatibilityIssue, workspaceBackupSchema, type WorkspaceBackup } from "@/lib/data/workspace-backup";
import { readLimitedJson, RequestBodyTooLargeError } from "@/lib/security/request-body";
import { isTrustedMutationRequest, mutationDeniedResponse } from "@/lib/security/request-origin";
import { acquireConcurrencySlot, consumePartitionRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return mutationDeniedResponse();
  const requestLimit = consumeRateLimit("workspace-restore:address", request, { limit: 8, windowMs: 10 * 60_000 });
  if (!requestLimit.allowed) return NextResponse.json({ error: "Too many restore attempts. Wait before trying again." }, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(requestLimit.retryAfterSeconds) } });
  let context;
  try { context = await requireFactionPermission("faction:manage"); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Workspace restore access was denied." }, { status: 403 }); }
  const rateLimit = consumePartitionRateLimit("workspace-restore:actor", context.actor.tornUserId, { limit: 5, windowMs: 10 * 60_000 });
  if (!rateLimit.allowed) return NextResponse.json({ error: "Too many restore attempts. Wait before trying again." }, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(rateLimit.retryAfterSeconds) } });
  const hasPostgres = Boolean(process.env.DATABASE_URL?.trim());
  if (!hasPostgres && !localDatabaseExists()) return NextResponse.json({ error: "Create a local database before restoring a backup." }, { status: 503 });
  let input: unknown;
  try { input = await readLimitedJson(request, 5_000_000); }
  catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError;
    return NextResponse.json({ error: tooLarge ? "The backup exceeds the 5 MB restore limit." : "The backup is not valid JSON." }, { status: tooLarge ? 413 : 400 });
  }
  const parsed = workspaceBackupSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: "This is not a valid Chainward workspace backup." }, { status: 400 });
  if (parsed.data.faction.tornFactionId !== context.faction.id) return NextResponse.json({ error: "The backup belongs to a different Torn faction." }, { status: 409 });
  const localCompatibilityIssue = hasPostgres ? null : localBackupCompatibilityIssue(parsed.data);
  if (localCompatibilityIssue) return NextResponse.json({ error: localCompatibilityIssue }, { status: 422, headers: { "cache-control": "no-store" } });

  const releaseActorSlot = acquireConcurrencySlot("workspace-restore:actor", context.actor.tornUserId, 1);
  if (!releaseActorSlot) return NextResponse.json({ error: "A workspace restore is already in progress. Wait for it to finish." }, { status: 429, headers: { "cache-control": "no-store", "retry-after": "1" } });
  const releaseProcessSlot = acquireConcurrencySlot("workspace-restore:process", "global", 2);
  if (!releaseProcessSlot) {
    releaseActorSlot();
    return NextResponse.json({ error: "The server is already processing other workspace restores." }, { status: 429, headers: { "cache-control": "no-store", "retry-after": "1" } });
  }

  try {
    const result = hasPostgres
      ? await restorePostgres(parsed.data, context.faction.id, context.faction.name, context.faction.tag)
      : restoreSqlite(parsed.data, context.faction.id);
    return NextResponse.json({ restored: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof BackupConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ error: "The backup could not be restored safely." }, { status: 500 });
  } finally {
    releaseProcessSlot();
    releaseActorSlot();
  }
}

class BackupConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupConflictError";
  }
}

async function restorePostgres(data: WorkspaceBackup, factionId: number, factionName: string, factionTag: string) {
  const { db } = await import("@/lib/db");
  return db.$transaction(async (tx) => {
    const faction = await tx.faction.upsert({ where: { tornFactionId: factionId }, update: { name: factionName, tag: factionTag }, create: { tornFactionId: factionId, name: factionName, tag: factionTag } });
    for (const setting of data.settings) {
      const value = setting.value === null ? Prisma.JsonNull : setting.value as Prisma.InputJsonValue;
      await tx.factionSetting.upsert({ where: { factionId_key: { factionId: faction.id, key: setting.key } }, update: { value }, create: { factionId: faction.id, key: setting.key, value } });
    }
    let imported = 0; let skipped = 0;
    for (const scheme of data.rewardSchemes) {
      const exists = await tx.rewardScheme.findUnique({ where: { factionId_name_version: { factionId: faction.id, name: scheme.name, version: scheme.version } } });
      if (exists) { skipped += 1; continue; }
      const definitionIds = new Map<string, string>();
      for (const reward of scheme.tiers.flatMap((tier) => tier.rewards)) {
        if (definitionIds.has(reward.name)) continue;
        const existingDefinition = await tx.rewardDefinition.findUnique({ where: { factionId_name: { factionId: faction.id, name: reward.name } } });
        if (existingDefinition && (existingDefinition.displayUnit !== reward.displayUnit || existingDefinition.kind !== reward.kind || existingDefinition.decimals !== reward.decimals)) {
          throw new BackupConflictError(`The reward “${reward.name}” already exists with different metadata. Rename it in the source workspace before restoring this backup.`);
        }
        const definition = existingDefinition
          ? await tx.rewardDefinition.update({ where: { id: existingDefinition.id }, data: { isArchived: false } })
          : await tx.rewardDefinition.create({ data: { factionId: faction.id, name: reward.name, displayUnit: reward.displayUnit, kind: reward.kind, decimals: reward.decimals } });
        definitionIds.set(reward.name, definition.id);
      }
      if (scheme.isDefault) await tx.rewardScheme.updateMany({ where: { factionId: faction.id, isDefault: true }, data: { isDefault: false } });
      await tx.rewardScheme.create({ data: { factionId: faction.id, name: scheme.name, description: scheme.description, version: scheme.version, status: scheme.status, isDefault: scheme.isDefault, tiers: { create: scheme.tiers.map((tier) => ({ label: tier.label, description: tier.description, minimumHits: tier.minimumHits, maximumHits: tier.maximumHits, position: tier.position, isEnabled: tier.enabled, rewards: { create: tier.rewards.map((reward) => ({ rewardDefinitionId: definitionIds.get(reward.name)!, amount: reward.amount })) } })) } } });
      imported += 1;
    }
    return { imported, skipped, settings: data.settings.length };
  });
}

function restoreSqlite(data: WorkspaceBackup, factionId: number) {
  const database = openLocalDatabase();
  if (!database) throw new Error("Local database is unavailable.");
  let imported = 0; let skipped = 0;
  try {
    database.exec("BEGIN IMMEDIATE");
    const upsertSetting = database.prepare("INSERT INTO faction_settings (faction_id, key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(faction_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at");
    const existingScheme = database.prepare("SELECT id FROM reward_schemes WHERE faction_id = ? AND name = ? AND version = ?");
    const insertScheme = database.prepare("INSERT INTO reward_schemes (id, faction_id, name, description, version, status, is_default, reward_name, reward_unit, locked_by_history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)");
    const insertTier = database.prepare("INSERT INTO reward_tiers (id, scheme_id, label, minimum_hits, maximum_hits, amount, enabled, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const now = new Date().toISOString();
    for (const setting of data.settings) upsertSetting.run(factionId, setting.key, JSON.stringify(setting.value), now);
    for (const scheme of data.rewardSchemes) {
      if (existingScheme.get(factionId, scheme.name, scheme.version)) { skipped += 1; continue; }
      if (scheme.isDefault) database.prepare("UPDATE reward_schemes SET is_default = 0, updated_at = ? WHERE faction_id = ? AND is_default = 1").run(now, factionId);
      const schemeId = randomUUID();
      const primaryReward = scheme.tiers[0]!.rewards[0]!;
      insertScheme.run(schemeId, factionId, scheme.name, scheme.description ?? "", scheme.version, scheme.status, scheme.isDefault ? 1 : 0, primaryReward.name, primaryReward.displayUnit, now, now);
      for (const tier of scheme.tiers) {
        const reward = tier.rewards[0]!;
        insertTier.run(randomUUID(), schemeId, tier.label, tier.minimumHits, tier.maximumHits, reward.amount, tier.enabled ? 1 : 0, tier.position);
      }
      imported += 1;
    }
    database.exec("COMMIT");
    return { imported, skipped, settings: data.settings.length };
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction may not have started. */ }
    throw error;
  } finally { database.close(); }
}
