import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptCredential } from "@/lib/security/credential-encryption";
import { connectionEncryptionSecret, createConnectionSession, readConnectionSession } from "./connection-session";

describe("Torn connection session", () => {
  const previousSecret = process.env.SESSION_SECRET;

  beforeAll(() => {
    process.env.SESSION_SECRET = "test-only-chainward-session-secret";
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  });

  it("round trips a verified connection without exposing plaintext", () => {
    const token = createConnectionSession("example-torn-key-A8F2", 3_212_954, 51_393, {
      tornUserName: "Skillerious",
      factionName: "Prive Cartel",
      factionTag: "PRIVE",
    });
    expect(token).not.toContain("example-torn-key");
    expect(readConnectionSession(token)).toMatchObject({
      apiKey: "example-torn-key-A8F2",
      tornUserId: 3_212_954,
      tornUserName: "Skillerious",
      factionId: 51_393,
      factionName: "Prive Cartel",
      factionTag: "PRIVE",
    });
  });

  it("rejects a modified session token", () => {
    const token = createConnectionSession("example-torn-key-A8F2", 3_212_954, 51_393, {
      tornUserName: "Skillerious",
      factionName: "Prive Cartel",
      factionTag: "PRIVE",
    });
    const segments = token.split(".");
    const encrypted = segments[2] ?? "";
    const index = Math.floor(encrypted.length / 2);
    segments[2] = `${encrypted.slice(0, index)}${encrypted[index] === "A" ? "B" : "A"}${encrypted.slice(index + 1)}`;
    const tampered = segments.join(".");
    expect(readConnectionSession(tampered)).toBeNull();
  });

  it("keeps temporary sessions from the previous release readable", () => {
    const encrypted = encryptCredential(JSON.stringify({
      apiKey: "example-torn-key-A8F2",
      tornUserId: 3_212_954,
      factionId: 51_393,
      expiresAt: Date.now() + 60_000,
    }), connectionEncryptionSecret());
    const token = `v1.${encrypted.encryptionIv.toString("base64url")}.${encrypted.encryptedKey.toString("base64url")}`;

    expect(readConnectionSession(token)).toMatchObject({
      tornUserId: 3_212_954,
      tornUserName: null,
      factionId: 51_393,
      factionName: null,
      factionTag: null,
    });
  });

  it("rejects malformed values", () => {
    expect(readConnectionSession(undefined)).toBeNull();
    expect(readConnectionSession("not-a-session")).toBeNull();
  });
});
