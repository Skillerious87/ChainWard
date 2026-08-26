export interface FactionAccessSummary {
  state: "inactive" | "pending" | "active";
  label: string;
  expiresAt: string | null;
  reference: string | null;
  startedAt: string | null;
  plan: string | null;
  payment: string | null;
  message: string | null;
  renewalRequest?: {
    reference: string;
    startedAt: string;
    plan: string | null;
    payment: string | null;
    message: string | null;
  } | null;
}
