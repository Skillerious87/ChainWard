/**
 * Observes the live Torn chain endpoint to confirm how its fields actually
 * behave, rather than reasoning about them from documentation alone.
 *
 * It reads the stored credential through the application's own decryption path
 * and never prints it. Only the chain fields, the response `Date` header, and
 * derived observations are written out.
 *
 * Run with:
 *   node --conditions=react-server --import tsx scripts/observe-chain-endpoint.mts [samples] [intervalSeconds]
 */
import { credentialEncryptionSecret } from "../src/lib/security/credential-secret";
import { decryptCredential } from "../src/lib/security/credential-encryption";
import { openCredentialDatabase } from "../src/lib/torn/credential-database";

interface Sample {
  at: number;
  serverDate: string | null;
  current: number;
  timeout: number;
  cooldown: number;
  max: number;
  start: number;
  end: number;
}

const samples = Math.min(20, Math.max(2, Number.parseInt(process.argv[2] ?? "6", 10) || 6));
const intervalSeconds = Math.min(60, Math.max(5, Number.parseInt(process.argv[3] ?? "10", 10) || 10));

function storedCredential(): { apiKey: string; factionId: number } {
  const database = openCredentialDatabase();
  try {
    const row = database.prepare(`
      SELECT faction_id, encrypted_key, encryption_iv, expires_at
      FROM remembered_torn_connections
      ORDER BY last_seen_at DESC LIMIT 1
    `).get() as unknown as { faction_id: number; encrypted_key: Uint8Array; encryption_iv: Uint8Array; expires_at: string } | undefined;
    if (!row) throw new Error("No remembered Torn connection is stored. Connect in the app with 'Remember this browser' enabled.");
    if (Date.parse(row.expires_at) <= Date.now()) throw new Error("The stored connection has expired. Reconnect in the app.");
    return { apiKey: decryptCredential(row.encrypted_key, row.encryption_iv, credentialEncryptionSecret()), factionId: row.faction_id };
  } finally { database.close(); }
}

const { apiKey, factionId } = storedCredential();
const base = process.env.TORN_API_BASE_URL ?? "https://api.torn.com/v2";

async function readChain(): Promise<Sample> {
  const response = await fetch(`${base}/faction/chain?comment=chainward-observe`, {
    headers: { Authorization: `ApiKey ${apiKey}`, Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json() as { chain?: Record<string, number>; error?: { code: number; error: string } };
  if (payload.error) throw new Error(`Torn refused the request: ${payload.error.error} (code ${payload.error.code}).`);
  const chain = payload.chain ?? {};
  return {
    at: Date.now(),
    serverDate: response.headers.get("date"),
    current: chain.current ?? 0,
    timeout: chain.timeout ?? 0,
    cooldown: chain.cooldown ?? 0,
    max: chain.max ?? 0,
    start: chain.start ?? 0,
    end: chain.end ?? 0,
  };
}

console.log(`Faction ${factionId} · ${samples} samples every ${intervalSeconds}s · base ${base}\n`);
console.log("elapsed  current  timeout  cooldown  max      end          server date");
console.log("-------  -------  -------  --------  -------  -----------  -------------------------");

const readings: Sample[] = [];
for (let index = 0; index < samples; index += 1) {
  if (index > 0) await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1_000));
  try {
    const sample = await readChain();
    readings.push(sample);
    const elapsed = Math.round((sample.at - readings[0]!.at) / 1_000);
    console.log(
      `${String(elapsed).padStart(6)}s  ${String(sample.current).padStart(7)}  ${String(sample.timeout).padStart(7)}  ${String(sample.cooldown).padStart(8)}  ${String(sample.max).padStart(7)}  ${String(sample.end).padStart(11)}  ${sample.serverDate ?? "not sent"}`,
    );
  } catch (error) {
    console.log(`  sample ${index + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("\nObservations");
if (readings.length < 2) {
  console.log("  Not enough samples to compare.");
} else {
  const first = readings[0]!;
  const last = readings.at(-1)!;
  const wallSeconds = Math.round((last.at - first.at) / 1_000);
  const timeoutDrop = first.timeout - last.timeout;
  console.log(`  Wall clock elapsed:      ${wallSeconds}s`);
  console.log(`  timeout decreased by:    ${timeoutDrop}s`);
  console.log(`  timeout behaves as:      ${Math.abs(timeoutDrop - wallSeconds) <= 2 ? "seconds remaining, counting down in real time" : "NOT a simple countdown — inspect the samples above"}`);
  console.log(`  hits gained:             ${last.current - first.current}`);
  const resets = readings.filter((sample, index) => index > 0 && sample.timeout > readings[index - 1]!.timeout + 2).length;
  console.log(`  timeout resets observed: ${resets}${resets > 0 ? " (each one follows a hit)" : ""}`);
  console.log(`  cooldown range:          ${Math.min(...readings.map((s) => s.cooldown))} to ${Math.max(...readings.map((s) => s.cooldown))}`);
  const plausibleTimestamp = last.cooldown > 1_000_000_000;
  console.log(`  cooldown is a:           ${last.cooldown === 0 ? "duration (zero while a chain runs)" : plausibleTimestamp ? "UNIX TIMESTAMP — the service assumption is wrong" : "duration in seconds"}`);
  console.log(`  max vs current:          max ${last.max}, current ${last.current} — ${last.max >= last.current ? "max is ahead, consistent with a bonus target" : "max is behind current, inspect"}`);
}
