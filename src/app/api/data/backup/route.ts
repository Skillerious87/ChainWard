import { NextResponse } from "next/server";
import { requireFactionPermission } from "@/lib/auth/faction-authorization";
import { localDatabaseExists, openLocalDatabase } from "@/lib/data/local-database";

export const runtime = "nodejs";

interface LocalSettingRow { key: string; value_json: string }
interface LocalSchemeRow { id: string; name: string; description: string; version: number; status: "ACTIVE" | "ARCHIVED"; is_default: number; reward_name: string; reward_unit: string }
interface LocalTierRow { label: string; minimum_hits: number; maximum_hits: number | null; position: number; enabled: number; amount: number }

export async function GET() {
  let context;
  try { context = await requireFactionPermission("faction:manage"); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Workspace backup access was denied." }, { status: 403 }); }
  const hasPostgres = Boolean(process.env.DATABASE_URL?.trim());
  if (!hasPostgres && !localDatabaseExists()) return NextResponse.json({ error: "Create a local database before downloading a backup." }, { status: 503 });

  try {
    const exportedAt = new Date();
    const backup = hasPostgres
      ? await createPostgresBackup(context.faction.id, context.faction.name, context.faction.tag, exportedAt)
      : createSqliteBackup(context.faction.id, context.faction.name, context.faction.tag, exportedAt);
    const stamp = exportedAt.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
    return new NextResponse(JSON.stringify(backup, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="chainward-${context.faction.id}-${stamp}.json"`, "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The workspace backup could not be created." }, { status: 500 });
  }
}

async function createPostgresBackup(factionId: number, factionName: string, factionTag: string, exportedAt: Date) {
  const { db } = await import("@/lib/db");
  const faction = await db.faction.findUnique({
    where: { tornFactionId: factionId },
    include: {
      settings: { orderBy: { key: "asc" } },
      rewardSchemes: { orderBy: [{ name: "asc" }, { version: "asc" }], include: { tiers: { orderBy: { position: "asc" }, include: { rewards: { include: { rewardDefinition: true } } } } } },
    },
  });
  return {
    format: "chainward-workspace-backup", version: 1, exportedAt: exportedAt.toISOString(),
    faction: { tornFactionId: factionId, name: factionName, tag: factionTag },
    settings: faction?.settings.filter((setting) => /^(appearance|rewards|payouts|members)\./.test(setting.key)).map((setting) => ({ key: setting.key, value: setting.value })) ?? [],
    rewardSchemes: faction?.rewardSchemes.map((scheme) => ({
      name: scheme.name, description: scheme.description, version: scheme.version, status: scheme.status, isDefault: scheme.isDefault,
      tiers: scheme.tiers.map((tier) => ({ label: tier.label, description: tier.description, minimumHits: tier.minimumHits, maximumHits: tier.maximumHits, position: tier.position, enabled: tier.isEnabled, rewards: tier.rewards.map((reward) => ({ name: reward.rewardDefinition.name, displayUnit: reward.rewardDefinition.displayUnit, kind: reward.rewardDefinition.kind, decimals: reward.rewardDefinition.decimals, amount: Number(reward.amount) })) })),
    })) ?? [],
  };
}

function createSqliteBackup(factionId: number, factionName: string, factionTag: string, exportedAt: Date) {
  const database = openLocalDatabase();
  if (!database) throw new Error("Local database is unavailable.");
  try {
    const settings = database.prepare("SELECT key, value_json FROM faction_settings WHERE faction_id = ? AND (key LIKE 'appearance.%' OR key LIKE 'rewards.%' OR key LIKE 'payouts.%' OR key LIKE 'members.%') ORDER BY key").all(factionId) as unknown as LocalSettingRow[];
    const schemes = database.prepare("SELECT id, name, description, version, status, is_default, reward_name, reward_unit FROM reward_schemes WHERE faction_id = ? ORDER BY name, version").all(factionId) as unknown as LocalSchemeRow[];
    const tierStatement = database.prepare("SELECT label, minimum_hits, maximum_hits, position, enabled, amount FROM reward_tiers WHERE scheme_id = ? ORDER BY position");
    return {
      format: "chainward-workspace-backup", version: 1, exportedAt: exportedAt.toISOString(),
      faction: { tornFactionId: factionId, name: factionName, tag: factionTag },
      settings: settings.map((setting) => ({ key: setting.key, value: JSON.parse(setting.value_json) as unknown })),
      rewardSchemes: schemes.map((scheme) => ({
        name: scheme.name, description: scheme.description || null, version: scheme.version, status: scheme.status, isDefault: Boolean(scheme.is_default),
        tiers: (tierStatement.all(scheme.id) as unknown as LocalTierRow[]).map((tier) => ({ label: tier.label, description: null, minimumHits: tier.minimum_hits, maximumHits: tier.maximum_hits, position: tier.position, enabled: Boolean(tier.enabled), rewards: [{ name: scheme.reward_name, displayUnit: scheme.reward_unit, kind: "ITEM", decimals: 0, amount: tier.amount }] })),
      })),
    };
  } finally { database.close(); }
}
