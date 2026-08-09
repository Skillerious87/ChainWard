import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnectionSession, readConnectionSession } from "./connection-session";

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
    const token = createConnectionSession("example-torn-key-A8F2", 3_212_954, 51_393);
    expect(token).not.toContain("example-torn-key");
    expect(readConnectionSession(token)).toMatchObject({
      apiKey: "example-torn-key-A8F2",
      tornUserId: 3_212_954,
      factionId: 51_393,
    });
  });

  it("rejects a modified session token", () => {
    const token = createConnectionSession("example-torn-key-A8F2", 3_212_954, 51_393);
    const segments = token.split(".");
    const encrypted = segments[2] ?? "";
    const index = Math.floor(encrypted.length / 2);
    segments[2] = `${encrypted.slice(0, index)}${encrypted[index] === "A" ? "B" : "A"}${encrypted.slice(index + 1)}`;
    const tampered = segments.join(".");
    expect(readConnectionSession(tampered)).toBeNull();
  });

  it("rejects malformed values", () => {
    expect(readConnectionSession(undefined)).toBeNull();
    expect(readConnectionSession("not-a-session")).toBeNull();
  });
});
