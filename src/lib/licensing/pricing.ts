export const licensePayment = {
  recipientName: "Skillerious",
  recipientTornId: 3_212_954,
  profileUrl: "https://www.torn.com/profiles.php?XID=3212954",
} as const;

export const licensePlans = [
  { id: "monthly", name: "Monthly", price: "1 Donator Pack", itemName: "Donator Pack", itemQuantity: 1, term: "30 days", durationDays: 30, licenseTerm: "MONTHLY", detail: "A flexible start for one faction." },
  { id: "quarterly", name: "Quarterly", price: "2 Donator Packs", itemName: "Donator Pack", itemQuantity: 2, term: "90 days", durationDays: 90, licenseTerm: "QUARTERLY", detail: "Save 1 Donator Pack compared with monthly access.", badge: "Popular" },
  { id: "annual", name: "Annual", price: "6 Donator Packs", itemName: "Donator Pack", itemQuantity: 6, term: "365 days", durationDays: 365, licenseTerm: "YEARLY", detail: "The best recurring value.", badge: "Best value" },
  { id: "lifetime", name: "Lifetime", price: "15 Donator Packs", itemName: "Donator Pack", itemQuantity: 15, term: "No expiry", durationDays: null, licenseTerm: "PERMANENT", detail: "One payment for permanent access." },
] as const;

export type LicensePlanId = (typeof licensePlans)[number]["id"];

/** `"Donator Pack"` stays singular for exactly one item, otherwise pluralises. */
export function pluralizeItemName(quantity: number, itemName: string): string {
  return quantity === 1 ? itemName : `${itemName}s`;
}

export function createPaymentReference(factionId: number): string {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `CW-${factionId}-${suffix}`;
}
