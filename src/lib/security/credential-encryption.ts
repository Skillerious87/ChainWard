import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export interface EncryptedCredential {
  encryptedKey: Buffer;
  encryptionIv: Buffer;
  fingerprint: string;
  lastFour: string;
}

export function encryptCredential(
  plaintext: string,
  encodedSecret: string,
): EncryptedCredential {
  if (!plaintext.trim()) throw new Error("Credential cannot be empty.");
  const key = decodeEncryptionSecret(encodedSecret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const encryptedKey = Buffer.concat([ciphertext, cipher.getAuthTag()]);

  return {
    encryptedKey,
    encryptionIv: iv,
    fingerprint: createHmac("sha256", key).update(plaintext).digest("hex"),
    lastFour: plaintext.slice(-4),
  };
}

export function decryptCredential(
  encryptedKey: Uint8Array,
  encryptionIv: Uint8Array,
  encodedSecret: string,
): string {
  const key = decodeEncryptionSecret(encodedSecret);
  const payload = Buffer.from(encryptedKey);
  if (payload.length <= AUTH_TAG_LENGTH) {
    throw new Error("Encrypted credential is malformed.");
  }

  const ciphertext = payload.subarray(0, -AUTH_TAG_LENGTH);
  const authTag = payload.subarray(-AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encryptionIv),
  );
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}

export function credentialsMatch(
  plaintext: string,
  expectedFingerprint: string,
  encodedSecret: string,
): boolean {
  const actual = createHmac("sha256", decodeEncryptionSecret(encodedSecret))
    .update(plaintext)
    .digest();
  const expected = Buffer.from(expectedFingerprint, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function decodeEncryptionSecret(encodedSecret: string): Buffer {
  const key = Buffer.from(encodedSecret, "base64");
  if (key.length !== 32) {
    throw new Error(
      "API_KEY_ENCRYPTION_SECRET must be a base64-encoded 32-byte value.",
    );
  }
  return key;
}
