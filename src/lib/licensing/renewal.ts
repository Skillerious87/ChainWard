export const LICENSE_RENEWAL_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export type LicenseRenewalPhase = "current" | "notice" | "urgent" | "final-day" | "expired" | "permanent";

export interface LicenseRenewalNotice {
  phase: LicenseRenewalPhase;
  renewalOpen: boolean;
  daysRemaining: number | null;
  title: string;
  detail: string;
}

export function getLicenseRenewalNotice(expiresAt: string | Date | null, now = new Date()): LicenseRenewalNotice {
  if (!expiresAt) return { phase: "permanent", renewalOpen: false, daysRemaining: null, title: "Lifetime access", detail: "This faction licence does not expire." };
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const remainingMs = expiry.getTime() - now.getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return { phase: "expired", renewalOpen: true, daysRemaining: 0, title: "Faction access has expired", detail: "Renewal is required before this workspace can be opened again." };
  }
  const daysRemaining = Math.ceil(remainingMs / DAY_MS);
  if (remainingMs > LICENSE_RENEWAL_WINDOW_DAYS * DAY_MS) {
    return { phase: "current", renewalOpen: false, daysRemaining, title: "Licence active", detail: `Access remains active for ${daysRemaining} days.` };
  }
  if (remainingMs <= DAY_MS) {
    return { phase: "final-day", renewalOpen: true, daysRemaining: 1, title: "Access ends within 24 hours", detail: "Renew now to prevent the faction workspace from locking." };
  }
  if (daysRemaining <= 3) {
    return { phase: "urgent", renewalOpen: true, daysRemaining, title: `Access ends in ${daysRemaining} days`, detail: "Renewal is open. Renew now to avoid an interruption for approved members." };
  }
  return { phase: "notice", renewalOpen: true, daysRemaining, title: `Access ends in ${daysRemaining} days`, detail: "Renewal is open. Additional time starts after the current term, so no paid days are lost." };
}

export function renewalExpiry(currentExpiry: Date | null, durationDays: number | null, approvedAt: Date): Date | null {
  if (durationDays === null) return null;
  const start = currentExpiry && currentExpiry > approvedAt ? currentExpiry : approvedAt;
  return new Date(start.getTime() + durationDays * DAY_MS);
}
