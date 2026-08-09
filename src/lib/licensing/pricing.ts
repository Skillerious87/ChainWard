export const licensePayment = {
  recipientName: "Skillerious",
  recipientTornId: 3_212_954,
  profileUrl: "https://www.torn.com/profiles.php?XID=3212954",
} as const;

export const licensePlans = [
  { id: "monthly", name: "Monthly", price: "2 Xanax", itemName: "Xanax", itemQuantity: 2, term: "30 days", durationDays: 30, licenseTerm: "MONTHLY", detail: "A flexible start for one faction." },
  { id: "quarterly", name: "Quarterly", price: "5 Xanax", itemName: "Xanax", itemQuantity: 5, term: "90 days", durationDays: 90, licenseTerm: "QUARTERLY", detail: "Save 1 Xanax compared with monthly access.", badge: "Popular" },
  { id: "annual", name: "Annual", price: "18 Xanax", itemName: "Xanax", itemQuantity: 18, term: "365 days", durationDays: 365, licenseTerm: "YEARLY", detail: "The best recurring value.", badge: "Best value" },
  { id: "lifetime", name: "Lifetime", price: "60 Xanax", itemName: "Xanax", itemQuantity: 60, term: "No expiry", durationDays: null, licenseTerm: "PERMANENT", detail: "One payment for permanent access." },
] as const;

export type LicensePlanId = (typeof licensePlans)[number]["id"];

export function createPaymentReference(factionId: number): string {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `CW-${factionId}-${suffix}`;
}
