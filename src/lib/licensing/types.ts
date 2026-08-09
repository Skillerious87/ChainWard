export interface FactionAccessSummary {
  state: "inactive" | "pending" | "active";
  label: string;
  expiresAt: string | null;
  reference: string | null;
  startedAt: string | null;
  plan: string | null;
  payment: string | null;
  message: string | null;
}
