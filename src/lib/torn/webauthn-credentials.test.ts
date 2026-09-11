import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  credentialExistsForFingerprint,
  deleteWebauthnCredential,
  deleteWebauthnCredentialsForFingerprint,
  listCredentialsForFingerprint,
  registerWebauthnCredential,
  resolveWebauthnCandidate,
  updateWebauthnCounter,
} from "./webauthn-credentials";

describe.sequential("WebAuthn credential storage (local backend)", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAppDataDirectory = process.env.CHAINWARD_APP_DATA_DIR;
  const originalSessionSecret = process.env.SESSION_SECRET;
  let temporaryDirectory = "";

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "chainward-webauthn-"));
    delete process.env.DATABASE_URL;
    process.env.CHAINWARD_APP_DATA_DIR = path.join(temporaryDirectory, "appdata");
    process.env.SESSION_SECRET = "test-only-stable-webauthn-secret";
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalAppDataDirectory === undefined) delete process.env.CHAINWARD_APP_DATA_DIR;
    else process.env.CHAINWARD_APP_DATA_DIR = originalAppDataDirectory;
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("has no credential for a fresh scope", async () => {
    await expect(credentialExistsForFingerprint("deadbeef")).resolves.toBe(false);
    await expect(listCredentialsForFingerprint("deadbeef")).resolves.toEqual([]);
  });

  it("stores a registered credential, resolves it back by credential ID, and never exposes the key outside its own decrypt path", async () => {
    await registerWebauthnCredential({
      credentialId: "cred-1",
      publicKey: new Uint8Array([1, 2, 3, 4]),
      counter: 0,
      transports: ["internal"],
      deviceLabel: "Test iPhone",
      tornFactionId: 51_393,
      keyFingerprint: "fingerprint-a",
      apiKey: "A1B2C3D4E5F6G7H8",
    });

    await expect(credentialExistsForFingerprint("fingerprint-a")).resolves.toBe(true);
    await expect(listCredentialsForFingerprint("fingerprint-a")).resolves.toEqual([{ credentialId: "cred-1", transports: ["internal"] }]);

    const candidate = await resolveWebauthnCandidate("cred-1");
    expect(candidate).toMatchObject({
      credentialId: "cred-1",
      counter: 0,
      tornFactionId: 51_393,
      keyFingerprint: "fingerprint-a",
      apiKey: "A1B2C3D4E5F6G7H8",
    });
    expect(Array.from(candidate!.publicKey)).toEqual([1, 2, 3, 4]);
  });

  it("returns null for an unknown credential ID rather than throwing", async () => {
    await expect(resolveWebauthnCandidate("does-not-exist")).resolves.toBeNull();
  });

  it("updates the stored counter after a successful authentication", async () => {
    await registerWebauthnCredential({
      credentialId: "cred-2",
      publicKey: new Uint8Array([9]),
      counter: 0,
      tornFactionId: 51_393,
      keyFingerprint: "fingerprint-b",
      apiKey: "A1B2C3D4E5F6G7H8",
    });
    await updateWebauthnCounter("cred-2", 7);
    await expect(resolveWebauthnCandidate("cred-2")).resolves.toMatchObject({ counter: 7 });
  });

  it("deletes a single credential without touching others sharing the same fingerprint", async () => {
    await registerWebauthnCredential({ credentialId: "cred-3a", publicKey: new Uint8Array([1]), counter: 0, tornFactionId: 1, keyFingerprint: "fingerprint-c", apiKey: "A1B2C3D4E5F6G7H8" });
    await registerWebauthnCredential({ credentialId: "cred-3b", publicKey: new Uint8Array([2]), counter: 0, tornFactionId: 1, keyFingerprint: "fingerprint-c", apiKey: "A1B2C3D4E5F6G7H8" });

    await deleteWebauthnCredential("cred-3a");
    await expect(resolveWebauthnCandidate("cred-3a")).resolves.toBeNull();
    await expect(resolveWebauthnCandidate("cred-3b")).resolves.not.toBeNull();
  });

  it("cascade-deletes every credential scoped to a fingerprint, e.g. when the underlying key is revoked", async () => {
    await registerWebauthnCredential({ credentialId: "cred-4a", publicKey: new Uint8Array([1]), counter: 0, tornFactionId: 1, keyFingerprint: "fingerprint-d", apiKey: "A1B2C3D4E5F6G7H8" });
    await registerWebauthnCredential({ credentialId: "cred-4b", publicKey: new Uint8Array([2]), counter: 0, tornFactionId: 1, keyFingerprint: "fingerprint-d", apiKey: "A1B2C3D4E5F6G7H8" });

    await deleteWebauthnCredentialsForFingerprint("fingerprint-d");

    await expect(resolveWebauthnCandidate("cred-4a")).resolves.toBeNull();
    await expect(resolveWebauthnCandidate("cred-4b")).resolves.toBeNull();
    await expect(credentialExistsForFingerprint("fingerprint-d")).resolves.toBe(false);
  });
});

describe("@simplewebauthn/server call shapes used by the onboarding routes", () => {
  // These exercise the exact option shapes the registration/authentication
  // routes pass, so a library upgrade that changes required fields fails
  // here instead of silently at sign-in time.
  it("generates discoverable-credential registration options and verifies a matching response", async () => {
    const rpID = "localhost";
    const options = await generateRegistrationOptions({
      rpName: "Chainward",
      rpID,
      userName: "Torn faction 51393",
      userID: new Uint8Array(32).fill(7),
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
      excludeCredentials: [],
    });
    expect(options.rp.id).toBe(rpID);
    expect(options.authenticatorSelection?.residentKey).toBe("required");
    expect(options.challenge).toBeTruthy();

    // A malformed/empty response must fail verification rather than throw
    // past the route's try/catch - confirms the failure path is a rejection,
    // not an unhandled exception, for whatever @simplewebauthn version is installed.
    await expect(verifyRegistrationResponse({
      response: { id: "x", rawId: "x", type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: "", attestationObject: "" } } as never,
      expectedChallenge: options.challenge,
      expectedOrigin: "http://localhost:3000",
      expectedRPID: rpID,
    })).rejects.toBeTruthy();
  });

  it("generates authentication options with no allowCredentials, enabling conditional UI", async () => {
    const options = await generateAuthenticationOptions({ rpID: "localhost", userVerification: "required" });
    expect(options.allowCredentials).toBeUndefined();
    expect(options.challenge).toBeTruthy();

    await expect(verifyAuthenticationResponse({
      response: { id: "x", rawId: "x", type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: "", authenticatorData: "", signature: "" } } as never,
      expectedChallenge: options.challenge,
      expectedOrigin: "http://localhost:3000",
      expectedRPID: "localhost",
      credential: { id: "x", publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
    })).rejects.toBeTruthy();
  });
});
