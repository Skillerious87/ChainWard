import { describe, expect, it } from "vitest";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";
import { redactLockedTelemetry } from "./telemetry";
import type { FactionAccessSummary } from "./types";

const telemetry: WorkspaceTelemetry = {
  source: "live",
  mode: "offline",
  checkedAt: "2026-08-11T00:00:00.000Z",
  faction: { id: 98_765, name: "Fixture", tag: "TEST", members: 6 },
  chain: { id: 7_000_004, current: 742, maximum: 1_000, timeoutSeconds: 238, modifier: 1.5, cooldownSeconds: 0, startedAt: 1, endedAt: 0, state: "active" },
  message: "Fixture values",
};

function access(state: FactionAccessSummary["state"]): FactionAccessSummary {
  return { state, label: "Test", expiresAt: null, reference: null, startedAt: null, plan: null, payment: null, message: null };
}

describe("locked telemetry redaction", () => {
  it("removes operational chain values from inactive and pending shells", () => {
    expect(redactLockedTelemetry(telemetry, access("inactive"))).toMatchObject({ faction: telemetry.faction, chain: null });
    expect(redactLockedTelemetry(telemetry, access("pending"))).toMatchObject({ faction: telemetry.faction, chain: null });
  });

  it("keeps operational values only for active access", () => {
    expect(redactLockedTelemetry(telemetry, access("active"))).toBe(telemetry);
  });
});
