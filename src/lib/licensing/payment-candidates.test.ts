import { describe, expect, it } from "vitest";
import { extractPaymentCandidates } from "./payment-candidates";
import type { UserEventsResponse } from "@/lib/torn/schemas";

function eventsOf(entries: Record<string, Record<string, unknown>>): UserEventsResponse {
  return { events: entries };
}

describe("extractPaymentCandidates", () => {
  it("extracts a plausible match from the most common event shape", () => {
    const now = Date.now();
    const response = eventsOf({
      "1": { event: "You received <b>2x</b> <a>Donator Pack</a> from PlayerName.", timestamp: Math.floor(now / 1_000) },
    });
    const [candidate] = extractPaymentCandidates(response, "Donator Pack");
    expect(candidate).toMatchObject({ id: "1", quantity: 2 });
    expect(candidate!.text).not.toContain("<b>");
  });

  it("tries alternate text field names when 'event' is absent", () => {
    const now = Date.now();
    const response = eventsOf({ "1": { message: "3x Donator Pack sent to you.", time: Math.floor(now / 1_000) } });
    expect(extractPaymentCandidates(response, "Donator Pack")).toHaveLength(1);
  });

  it("ignores events that don't mention the item", () => {
    const response = eventsOf({ "1": { event: "You went to the hospital.", timestamp: Math.floor(Date.now() / 1_000) } });
    expect(extractPaymentCandidates(response, "Donator Pack")).toEqual([]);
  });

  it("drops events with no usable text under any known key", () => {
    const response = eventsOf({ "1": { seen: 1, category: 5 } });
    expect(extractPaymentCandidates(response, "Donator Pack")).toEqual([]);
  });

  it("excludes events older than the window", () => {
    const old = Math.floor((Date.now() - 60 * 24 * 60 * 60 * 1_000) / 1_000);
    const response = eventsOf({ "1": { event: "1x Donator Pack received.", timestamp: old } });
    expect(extractPaymentCandidates(response, "Donator Pack", { windowMs: 30 * 24 * 60 * 60 * 1_000 })).toEqual([]);
  });

  it("sorts newest first and respects the limit", () => {
    const now = Math.floor(Date.now() / 1_000);
    const response = eventsOf({
      older: { event: "1x Donator Pack.", timestamp: now - 100 },
      newer: { event: "1x Donator Pack.", timestamp: now - 10 },
      newest: { event: "1x Donator Pack.", timestamp: now },
    });
    const candidates = extractPaymentCandidates(response, "Donator Pack", { limit: 2 });
    expect(candidates.map((candidate) => candidate.id)).toEqual(["newest", "newer"]);
  });

  it("matches case-insensitively and is unmoved by unrelated fields", () => {
    const response = eventsOf({ "1": { event: "You received a DONATOR PACK.", timestamp: Math.floor(Date.now() / 1_000), unrelated: { nested: true } } });
    expect(extractPaymentCandidates(response, "Donator Pack")).toHaveLength(1);
  });

  it("returns no quantity when none can be parsed", () => {
    const response = eventsOf({ "1": { event: "You received a Donator Pack.", timestamp: Math.floor(Date.now() / 1_000) } });
    expect(extractPaymentCandidates(response, "Donator Pack")[0]).toMatchObject({ quantity: null });
  });
});
