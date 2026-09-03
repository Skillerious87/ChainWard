import "server-only";

import { randomUUID } from "node:crypto";

const LOG_PREFIX = "[chainward:onboarding-validation-failed]";
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_STACK_LENGTH = 6_000;

export type OnboardingValidationStage =
  | "torn-api-validation"
  | "access-request"
  | "remembered-connection"
  | "temporary-session"
  | "response-construction";

interface DiagnosticInput {
  apiKey: string;
  diagnosticId: string;
  error: unknown;
  environment?: Readonly<Record<string, string | undefined>>;
  rememberRequested: boolean;
  stage: OnboardingValidationStage;
}

type ReportInput = Omit<DiagnosticInput, "diagnosticId">;

export function reportUnexpectedOnboardingValidationFailure(input: ReportInput): string {
  const diagnosticId = randomUUID();
  const diagnostic = buildOnboardingValidationDiagnostic({
    ...input,
    diagnosticId,
  });

  console.error(LOG_PREFIX, JSON.stringify(diagnostic));

  return diagnosticId;
}

export function buildOnboardingValidationDiagnostic(input: DiagnosticInput) {
  const environment = input.environment ?? process.env;
  const sensitiveValues = [
    input.apiKey,
    environment.DATABASE_URL,
    environment.SESSION_SECRET,
    environment.API_KEY_ENCRYPTION_SECRET,
  ];

  return {
    event: "onboarding.validation_failed",
    diagnosticId: input.diagnosticId,
    stage: input.stage,
    rememberRequested: input.rememberRequested,
    error: describeError(input.error, sensitiveValues),
    configuration: {
      nodeEnv: environment.NODE_ENV || "unknown",
      vercel: environment.VERCEL === "1",
      vercelRegion: environment.VERCEL_REGION || "unknown",
      database: summarizeDatabaseUrl(environment.DATABASE_URL),
      sessionSecret: summarizeSessionSecret(environment.SESSION_SECRET),
      apiKeyEncryptionSecret: summarizeEncryptionSecret(environment.API_KEY_ENCRYPTION_SECRET),
      tornApiBaseUrl: summarizeTornBaseUrl(environment.TORN_API_BASE_URL),
    },
  };
}

function describeError(error: unknown, sensitiveValues: Array<string | undefined>) {
  if (!(error instanceof Error)) {
    return {
      name: "NonErrorThrownValue",
      message: `A non-Error value of type ${typeof error} was thrown.`,
    };
  }

  return {
    name: redact(error.name || "Error", sensitiveValues, 200),
    message: redact(error.message || "No error message was provided.", sensitiveValues, MAX_MESSAGE_LENGTH),
    stack: error.stack ? redact(error.stack, sensitiveValues, MAX_STACK_LENGTH) : undefined,
    cause: error.cause instanceof Error
      ? {
          name: redact(error.cause.name || "Error", sensitiveValues, 200),
          message: redact(error.cause.message || "No cause message was provided.", sensitiveValues, MAX_MESSAGE_LENGTH),
        }
      : undefined,
  };
}

function redact(value: string, sensitiveValues: Array<string | undefined>, maximumLength: number): string {
  let redacted = value;
  for (const sensitiveValue of sensitiveValues) {
    if (!sensitiveValue) continue;
    redacted = redacted.replaceAll(sensitiveValue, "[REDACTED]");
    const encodedValue = encodeURIComponent(sensitiveValue);
    if (encodedValue !== sensitiveValue) redacted = redacted.replaceAll(encodedValue, "[REDACTED]");
  }

  redacted = redacted
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/giu, "[REDACTED_DATABASE_URL]")
    .replace(/([?&](?:key|apiKey|api_key)=)[^&\s]+/giu, "$1[REDACTED]");

  return redacted.length <= maximumLength
    ? redacted
    : `${redacted.slice(0, maximumLength)}...[truncated]`;
}

function summarizeDatabaseUrl(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  const configured = trimmed.length > 0;
  let supportedProtocol = false;
  if (configured) {
    try {
      const protocol = new URL(trimmed).protocol;
      supportedProtocol = protocol === "postgres:" || protocol === "postgresql:";
    } catch {
      supportedProtocol = false;
    }
  }

  return { configured, supportedProtocol };
}

function summarizeSessionSecret(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  const utf8Bytes = Buffer.byteLength(trimmed, "utf8");
  return {
    configured: utf8Bytes > 0,
    utf8Bytes,
    meetsProductionMinimum: utf8Bytes >= 32,
  };
}

function summarizeEncryptionSecret(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  const decodedBytes = trimmed ? Buffer.from(trimmed, "base64").length : 0;
  return {
    configured: trimmed.length > 0,
    decodedBytes,
    isValidLength: decodedBytes === 32,
  };
}

function summarizeTornBaseUrl(value: string | undefined) {
  if (!value?.trim()) return { configured: false, validHttpUrl: true };
  try {
    const protocol = new URL(value).protocol;
    return { configured: true, validHttpUrl: protocol === "http:" || protocol === "https:" };
  } catch {
    return { configured: true, validHttpUrl: false };
  }
}
