import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOnboardingValidationDiagnostic,
  reportUnexpectedOnboardingValidationFailure,
} from "./onboarding-validation";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("onboarding validation diagnostics", () => {
  it("reports useful configuration shape without exposing secrets", () => {
    const apiKey = "AbCdEf1234567890";
    const databaseUrl = "postgresql://owner:database-password@example.invalid/chainward";
    const sessionSecret = "short-secret";
    const encryptionSecret = Buffer.alloc(32, 7).toString("base64");
    const error = new Error(`Could not use ${databaseUrl} with key=${apiKey}.`);
    error.stack = `Error: ${sessionSecret} ${encryptionSecret} ${databaseUrl}?apiKey=${apiKey}`;

    const diagnostic = buildOnboardingValidationDiagnostic({
      apiKey,
      diagnosticId: "test-diagnostic-id",
      error,
      environment: {
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_REGION: "iad1",
        DATABASE_URL: databaseUrl,
        SESSION_SECRET: sessionSecret,
        API_KEY_ENCRYPTION_SECRET: encryptionSecret,
        TORN_API_BASE_URL: "https://api.torn.com/v2",
      },
      rememberRequested: true,
      stage: "remembered-connection",
    });
    const serialized = JSON.stringify(diagnostic);

    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(databaseUrl);
    expect(serialized).not.toContain("database-password");
    expect(serialized).not.toContain(sessionSecret);
    expect(serialized).not.toContain(encryptionSecret);
    expect(diagnostic.configuration.database).toEqual({ configured: true, supportedProtocol: true });
    expect(diagnostic.configuration.sessionSecret).toEqual({
      configured: true,
      utf8Bytes: 12,
      meetsProductionMinimum: false,
    });
    expect(diagnostic.configuration.apiKeyEncryptionSecret).toEqual({
      configured: true,
      decodedBytes: 32,
      isValidLength: true,
    });
  });

  it("does not stringify a non-Error thrown value", () => {
    const secretThrownValue = "AbCdEf1234567890";
    const diagnostic = buildOnboardingValidationDiagnostic({
      apiKey: secretThrownValue,
      diagnosticId: "test-diagnostic-id",
      error: secretThrownValue,
      environment: {},
      rememberRequested: false,
      stage: "torn-api-validation",
    });

    expect(JSON.stringify(diagnostic)).not.toContain(secretThrownValue);
    expect(diagnostic.error.message).toBe("A non-Error value of type string was thrown.");
  });

  it("writes a searchable, correlated, redacted log entry", () => {
    const apiKey = "AbCdEf1234567890";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const diagnosticId = reportUnexpectedOnboardingValidationFailure({
      apiKey,
      error: new Error(`Validation failed for ${apiKey}.`),
      environment: { NODE_ENV: "production", SESSION_SECRET: "another-short-secret" },
      rememberRequested: false,
      stage: "temporary-session",
    });
    const loggedText = consoleError.mock.calls.flat().join(" ");

    expect(consoleError).toHaveBeenCalledOnce();
    expect(loggedText).toContain("[chainward:onboarding-validation-failed]");
    expect(loggedText).toContain(diagnosticId);
    expect(loggedText).toContain("temporary-session");
    expect(loggedText).not.toContain(apiKey);
    expect(loggedText).not.toContain("another-short-secret");
  });
});
