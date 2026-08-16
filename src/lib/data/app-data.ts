import "server-only";

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const APPLICATION_DIRECTORY = "Chainward";

/**
 * Returns a machine-private data directory that is deliberately outside the
 * repository. Local credentials and the key used to encrypt them live here.
 */
export function chainwardAppDataDirectory(): string {
  const configured = process.env.CHAINWARD_APP_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);

  if (process.platform === "win32") {
    const windowsAppData = process.env.LOCALAPPDATA?.trim() || process.env.APPDATA?.trim();
    if (windowsAppData) return path.join(windowsAppData, APPLICATION_DIRECTORY);
  }

  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", APPLICATION_DIRECTORY);
  }

  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  return xdgDataHome
    ? path.join(xdgDataHome, APPLICATION_DIRECTORY.toLowerCase())
    : path.join(homedir(), ".local", "share", APPLICATION_DIRECTORY.toLowerCase());
}

export function connectionSecretPath(): string {
  return path.join(chainwardAppDataDirectory(), ".connection-encryption-secret");
}

/** Moves the pre-AppData development secret without ever returning it. */
export function migrateLegacyConnectionSecret(): boolean {
  const destination = connectionSecretPath();
  const legacy = path.join(process.cwd(), "data", ".chainward-session-secret");
  if (!existsSync(legacy)) return true;

  const legacyValue = readValidBase64Secret(legacy);
  if (!legacyValue) return false;
  if (existsSync(destination)) {
    const destinationValue = readValidBase64Secret(destination);
    if (!destinationValue || destinationValue !== legacyValue) return false;
    unlinkSync(legacy);
    return true;
  }

  mkdirSync(path.dirname(destination), { recursive: true });
  try {
    writeFileSync(destination, legacyValue, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    const destinationValue = readValidBase64Secret(destination);
    if (!destinationValue || destinationValue !== legacyValue) throw error;
  }
  unlinkSync(legacy);
  return true;
}

function readValidBase64Secret(filePath: string): string | null {
  const stored = readFileSync(filePath, "utf8").trim();
  return Buffer.from(stored, "base64").length === 32 ? stored : null;
}
