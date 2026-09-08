import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { openLocalDatabase } from "@/lib/data/local-database";
import { decryptCredential, encryptCredential } from "@/lib/security/credential-encryption";
import { credentialEncryptionSecret } from "@/lib/security/credential-secret";

/**
 * The operator's own FFScouter API key (ffscouter.com — an independent,
 * free, community Fair Fight estimation service, not a Torn credential).
 * Stored as its own setting, separate from the target list itself
 * (`targets.private.<operatorId>` in store.ts): the list is rewritten on
 * every add/remove/note/tag/pin edit, and a rarely-changed credential
 * shouldn't ride along on that hot path or share its blast radius.
 * Encrypted at rest with the same mechanism already protecting the Torn API
 * key, for the same reason: Settings already promises every stored key is
 * "Encrypted server-side," and this is a real credential even though
 * FFScouter itself treats its estimates as public data.
 */
const prefix = "targets.ffscouter-key.";

interface Faction { id: number; name: string; tag: string }

const storedKeySchema = z.object({
  encryptedKey: z.string(),
  encryptionIv: z.string(),
  fingerprint: z.string(),
  lastFour: z.string(),
});

const FFSCOUTER_KEY_PATTERN = /^[a-z0-9]{16}$/i;

export function isValidFfscouterKeyFormat(value: string): boolean {
  return FFSCOUTER_KEY_PATTERN.test(value.trim());
}

export async function hasFfscouterKey(factionId: number, operatorId: number): Promise<boolean> {
  return (await readFfscouterKeyRecord(factionId, operatorId)) !== null;
}

/** Returns the last four characters only, for a confirmation message —
 *  never the full key. */
export async function ffscouterKeyLastFour(factionId: number, operatorId: number): Promise<string | null> {
  const record = await readFfscouterKeyRecord(factionId, operatorId);
  return record?.lastFour ?? null;
}

export async function readFfscouterKey(factionId: number, operatorId: number): Promise<string | null> {
  const record = await readFfscouterKeyRecord(factionId, operatorId);
  if (!record) return null;
  try {
    return decryptCredential(
      Buffer.from(record.encryptedKey, "base64"),
      Buffer.from(record.encryptionIv, "base64"),
      credentialEncryptionSecret(),
    );
  } catch {
    return null;
  }
}

export async function saveFfscouterKey(faction: Faction, operatorId: number, apiKey: string): Promise<string> {
  const trimmed = apiKey.trim();
  if (!isValidFfscouterKeyFormat(trimmed)) {
    throw new Error("That doesn't look like an FFScouter API key — it should be 16 letters and numbers from your ffscouter.com account.");
  }
  const encrypted = encryptCredential(trimmed, credentialEncryptionSecret());
  const record = storedKeySchema.parse({
    encryptedKey: encrypted.encryptedKey.toString("base64"),
    encryptionIv: encrypted.encryptionIv.toString("base64"),
    fingerprint: encrypted.fingerprint,
    lastFour: encrypted.lastFour,
  });
  const key = `${prefix}${operatorId}`;
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await db.$transaction(async (tx) => {
      const tenant = await tx.faction.upsert({ where: { tornFactionId: faction.id }, update: {}, create: { tornFactionId: faction.id, name: faction.name, tag: faction.tag } });
      await tx.factionSetting.upsert({
        where: { factionId_key: { factionId: tenant.id, key } },
        create: { factionId: tenant.id, key, value: record as unknown as Prisma.InputJsonValue },
        update: { value: record as unknown as Prisma.InputJsonValue },
      });
    });
  } else {
    const database = openLocalDatabase();
    if (!database) throw new Error("Create workspace storage in Settings before adding an FFScouter key.");
    try {
      database.prepare("INSERT INTO faction_settings (faction_id, key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(faction_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
        .run(faction.id, key, JSON.stringify(record), new Date().toISOString());
    } finally {
      database.close();
    }
  }
  return record.lastFour;
}

export async function clearFfscouterKey(faction: Faction, operatorId: number): Promise<void> {
  const key = `${prefix}${operatorId}`;
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    await db.factionSetting.deleteMany({ where: { faction: { tornFactionId: faction.id }, key } });
  } else {
    const database = openLocalDatabase();
    if (!database) return;
    try {
      database.prepare("DELETE FROM faction_settings WHERE faction_id = ? AND key = ?").run(faction.id, key);
    } finally {
      database.close();
    }
  }
}

async function readFfscouterKeyRecord(factionId: number, operatorId: number): Promise<z.infer<typeof storedKeySchema> | null> {
  const key = `${prefix}${operatorId}`;
  let raw: unknown;
  if (process.env.DATABASE_URL?.trim()) {
    const { db } = await import("@/lib/db");
    const row = await db.factionSetting.findFirst({ where: { faction: { tornFactionId: factionId }, key }, select: { value: true } });
    raw = row?.value;
  } else {
    const database = openLocalDatabase();
    if (!database) return null;
    try {
      const row = database.prepare("SELECT value_json FROM faction_settings WHERE faction_id = ? AND key = ?").get(factionId, key) as { value_json: string } | undefined;
      raw = row ? (JSON.parse(row.value_json) as unknown) : undefined;
    } catch {
      return null;
    } finally {
      database.close();
    }
  }
  if (raw === undefined || raw === null) return null;
  const parsed = storedKeySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
