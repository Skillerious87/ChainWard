import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptCredential } from "@/lib/security/credential-encryption";
import { SavedConnectionUnavailableError } from "./connection-errors";
import { readRememberedConnection } from "./remembered-connection";

const db = vi.hoisted(() => ({
  session: { findUnique: vi.fn(), delete: vi.fn(), update: vi.fn() },
  factionApiCredential: { findFirst: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
// The retry helper has its own coverage; exercise the exhausted result here.
vi.mock("@/lib/data/with-db-retry", () => ({ withDbRetry: (run: () => Promise<unknown>) => run() }));

const token = `v1.${"a".repeat(43)}.51393.${"b".repeat(64)}`;
const credentialSecret = "test-only-credential-secret-with-32-characters";
const sessionSecret = "test-only-legacy-session-secret-with-32-characters";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/unused");
  vi.stubEnv("API_KEY_ENCRYPTION_SECRET", credentialSecret);
  vi.stubEnv("SESSION_SECRET", sessionSecret);
  db.session.delete.mockResolvedValue({});
  db.session.update.mockResolvedValue({});
  db.factionApiCredential.update.mockResolvedValue({});
  db.session.findUnique.mockResolvedValue({ id: "session", userId: "user", user: { tornUserId: 123, name: "Tester", avatarUrl: null }, expiresAt: new Date(Date.now() + 86_400_000), lastSeenAt: new Date() });
  db.factionApiCredential.findFirst.mockResolvedValue(credential(credentialSecret));
});
afterEach(() => vi.unstubAllEnvs());

function credential(secret: string) {
  const encrypted = encryptCredential("test-api-key", createHash("sha256").update(secret).digest("base64"));
  return { id: "credential", ownerTornUserId: 123, encryptedKey: encrypted.encryptedKey, encryptionIv: encrypted.encryptionIv, faction: { tornFactionId: 51_393, name: "Test faction", tag: "TEST" } };
}

describe("remembered connection storage recovery", () => {
  it("reports an exhausted database outage without deleting a session", async () => {
    db.session.findUnique.mockRejectedValue(new Error("Database unavailable"));
    await expect(readRememberedConnection(token)).rejects.toBeInstanceOf(SavedConnectionUnavailableError);
    expect(db.session.delete).not.toHaveBeenCalled();
  });

  it("preserves a valid legacy session when its credential migration cannot be written", async () => {
    db.factionApiCredential.findFirst.mockResolvedValue(credential(sessionSecret));
    db.factionApiCredential.update.mockRejectedValue(new Error("Database unavailable"));
    await expect(readRememberedConnection(token)).rejects.toBeInstanceOf(SavedConnectionUnavailableError);
    expect(db.session.delete).not.toHaveBeenCalled();
  });

  it("restores the same token after storage recovers", async () => {
    db.session.findUnique.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(readRememberedConnection(token)).rejects.toBeInstanceOf(SavedConnectionUnavailableError);
    await expect(readRememberedConnection(token)).resolves.toMatchObject({ tornUserId: 123, factionId: 51_393, apiKey: "test-api-key" });
  });

  it("still refuses missing, expired, and mismatched sessions", async () => {
    const session = await db.session.findUnique();
    db.session.findUnique.mockResolvedValueOnce(null);
    await expect(readRememberedConnection(token)).resolves.toBeNull();
    db.session.findUnique.mockResolvedValueOnce({ ...session, expiresAt: new Date(0) });
    await expect(readRememberedConnection(token)).resolves.toBeNull();
    expect(db.session.delete).toHaveBeenCalledOnce();
    db.factionApiCredential.findFirst.mockResolvedValue({ ...credential(credentialSecret), ownerTornUserId: 999 });
    await expect(readRememberedConnection(token)).resolves.toBeNull();
  });
});
