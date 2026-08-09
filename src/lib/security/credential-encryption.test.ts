import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  credentialsMatch,
  decryptCredential,
  encryptCredential,
} from "./credential-encryption";

describe("credential encryption", () => {
  const secret = randomBytes(32).toString("base64");

  it("round trips an API credential without storing plaintext", () => {
    const result = encryptCredential("example-secret-A8F2", secret);
    expect(result.encryptedKey.toString("utf8")).not.toContain("example-secret");
    expect(result.lastFour).toBe("A8F2");
    expect(decryptCredential(result.encryptedKey, result.encryptionIv, secret)).toBe(
      "example-secret-A8F2",
    );
  });

  it("creates a keyed fingerprint for duplicate detection", () => {
    const result = encryptCredential("same-key", secret);
    expect(credentialsMatch("same-key", result.fingerprint, secret)).toBe(true);
    expect(credentialsMatch("different-key", result.fingerprint, secret)).toBe(
      false,
    );
  });
});
