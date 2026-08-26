import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnlockWorkspace } from "./unlock-workspace";

describe("UnlockWorkspace active access", () => {
  it("keeps an unassigned faction member locked even when the faction licence is active", () => {
    const html = renderToStaticMarkup(<UnlockWorkspace factionId={51_393} factionName="Prive Cartel" access={{ state: "active", label: "Monthly access", expiresAt: "2026-09-20T00:00:00.000Z", reference: "CW-51393-LOCKED", startedAt: "2026-08-20T00:00:00.000Z", plan: "MONTHLY", payment: null, message: null }} />);
    expect(html).toContain("Player approval required");
    expect(html).toContain("licence or role from a previous faction never follows you");
    expect(html).not.toContain('href="/dashboard"');
  });

  it("turns lifetime access into an actionable entitlement dashboard", () => {
    const html = renderToStaticMarkup(<UnlockWorkspace
      factionId={51_393}
      factionName="Prive Cartel"
      workspaceAuthorized
      access={{
        state: "active",
        label: "Lifetime access",
        expiresAt: null,
        reference: "CW-51393-177FE90A",
        startedAt: "2026-08-12T14:10:00.000Z",
        plan: "PERMANENT",
        payment: "10 Donator Packs",
        message: null,
      }}
    />);

    expect(html).toContain("Permanent faction entitlement");
    expect(html).toContain("No renewal required");
    expect(html).toContain("No per-seat limits");
    expect(html).toContain("CW-51393-177FE90A");
    expect(html).toContain('aria-label="Copy licence reference"');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/analytics"');
    expect(html).toContain('href="/payouts"');
    expect(html).toContain("Future Chainward releases stay included.");
  });

  it("shows the explicit end date for a fixed-term active licence", () => {
    const html = renderToStaticMarkup(<UnlockWorkspace
      factionId={51_393}
      factionName="Prive Cartel"
      workspaceAuthorized
      access={{
        state: "active",
        label: "Quarterly access",
        expiresAt: "2026-11-12T00:00:00.000Z",
        reference: "CW-51393-TERM",
        startedAt: "2026-08-12T00:00:00.000Z",
        plan: "QUARTERLY",
        payment: "3 Donator Packs",
        message: null,
      }}
    />);

    expect(html).toContain("Protected faction entitlement");
    expect(html).toContain("Through 12 Nov 2026");
    expect(html).not.toContain("No renewal required");
  });
});
