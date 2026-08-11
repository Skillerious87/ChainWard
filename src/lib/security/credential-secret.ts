import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chainwardAppDataDirectory } from "@/lib/data/app-data";

const CREDENTIAL_SECRET_FILENAME = ".credential-encryption-secret";

/**
 * Returns a key dedicated to stored API credentials. Session cookies use a
 * separate secret so disclosure or rotation of one key does not expose both
 * trust boundaries.
 */
export function credentialEncryptionSecret(): string {
  const configured = process.env.API_KEY_ENCRYPTION_SECRET?.trim();
  if (configured) return validateSecret(configured);
  if (process.env.NODE_ENV === "production") {
    throw new Error("API_KEY_ENCRYPTION_SECRET must be configured before storing Torn API credentials.");
  }
  return readOrCreateLocalCredentialSecret();
}

function validateSecret(value: string): string {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 32) return value;
  if (process.env.NODE_ENV === "production") throw new Error("API_KEY_ENCRYPTION_SECRET must be a base64-encoded 32-byte value.");
  return createHash("sha256").update(value).digest("base64");
}

function readOrCreateLocalCredentialSecret(): string {
  const secretPath = path.join(chainwardAppDataDirectory(), CREDENTIAL_SECRET_FILENAME);
  if (existsSync(secretPath)) {
    const stored = readFileSync(secretPath, "utf8").trim();
    if (Buffer.from(stored, "base64").length === 32) return stored;
    throw new Error("The Chainward credential encryption secret is malformed.");
  }

  mkdirSync(path.dirname(secretPath), { recursive: true });
  const generated = randomBytes(32).toString("base64");
  try {
    writeFileSync(secretPath, generated, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return generated;
  } catch (error: unknown) {
    if (existsSync(secretPath)) {
      const stored = readFileSync(secretPath, "utf8").trim();
      if (Buffer.from(stored, "base64").length === 32) return stored;
    }
    throw error;
  }
}
