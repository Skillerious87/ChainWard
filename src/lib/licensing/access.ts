export type LicenseState =
  | "PENDING"
  | "ACTIVE"
  | "SUSPENDED"
  | "EXPIRED"
  | "REVOKED"
  | "REJECTED";

export interface LicenseRecord {
  status: LicenseState;
  issuedAt: Date | null;
  expiresAt: Date | null;
}

export type LicenseDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "NOT_LICENSED" | "NOT_ACTIVE" | "NOT_STARTED" | "EXPIRED";
    };

export function evaluateLicense(
  license: LicenseRecord | null,
  now: Date,
  licensingEnabled: boolean,
): LicenseDecision {
  if (!licensingEnabled) return { allowed: true };
  if (!license) return { allowed: false, reason: "NOT_LICENSED" };
  if (license.status !== "ACTIVE") return { allowed: false, reason: "NOT_ACTIVE" };
  if (license.issuedAt && license.issuedAt > now) {
    return { allowed: false, reason: "NOT_STARTED" };
  }
  if (license.expiresAt && license.expiresAt <= now) {
    return { allowed: false, reason: "EXPIRED" };
  }
  return { allowed: true };
}
