import "server-only";

import type { UserEventsResponse } from "@/lib/torn/schemas";

export interface PaymentCandidate {
  id: string;
  timestampMs: number;
  text: string;
  quantity: number | null;
}

const TEXT_KEYS = ["event", "text", "message", "title"] as const;
const TIME_KEYS = ["timestamp", "time", "date", "created"] as const;

/**
 * Best-effort suggestions for which of the platform owner's own recent Torn
 * events might be an incoming payment for a pending licence request. This is
 * a convenience list only — the reviewer still confirms the transfer by hand
 * in Torn, per the manual-verification checklist it sits beside. A missed
 * match costs nothing; a wrongly-parsed one would be actively misleading, so
 * an event that doesn't clearly mention the item is dropped rather than
 * guessed at.
 *
 * Torn's exact v2 field names for a single `/user/events` entry are not
 * published (see docs/torn-api.md), so this tries several plausible key
 * names instead of assuming one.
 */
export function extractPaymentCandidates(
  response: UserEventsResponse,
  itemName: string,
  { windowMs = 30 * 24 * 60 * 60 * 1_000, limit = 5 }: { windowMs?: number; limit?: number } = {},
): PaymentCandidate[] {
  const now = Date.now();
  const needle = itemName.toLowerCase();
  const candidates: PaymentCandidate[] = [];
  for (const [id, raw] of Object.entries(response.events)) {
    const rawText = firstStringValue(raw, TEXT_KEYS);
    if (!rawText) continue;
    const text = stripHtml(rawText);
    if (!text.toLowerCase().includes(needle)) continue;
    const timestampMs = firstTimestampMs(raw, TIME_KEYS) ?? now;
    if (now - timestampMs > windowMs) continue;
    candidates.push({ id, timestampMs, text, quantity: extractQuantity(text) });
  }
  candidates.sort((a, b) => b.timestampMs - a.timestampMs);
  return candidates.slice(0, limit);
}

function firstStringValue(raw: unknown, keys: readonly string[]): string | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function firstTimestampMs(raw: unknown, keys: readonly string[]): number | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      // Torn timestamps are seconds; anything already millisecond-scale is left alone.
      return value > 10_000_000_000 ? value : value * 1_000;
    }
  }
  return null;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function extractQuantity(text: string): number | null {
  const match = /(\d+)\s*x\b/i.exec(text) ?? /\b(\d+)\s+donator/i.exec(text);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}
