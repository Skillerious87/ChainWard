import { describe, expect, it } from "vitest";
import { buildOperationsBrief } from "./operations-brief";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";

const checkedAt = "2026-08-09T10:00:00.000Z";
const now = Date.parse(checkedAt);

function telemetry(timeoutSeconds = 300): WorkspaceTelemetry {
  return {
    source: "live",
    checkedAt,
    faction: { id: 1, name: "Test Faction", tag: "TF", members: 50 },
    chain: {
      id: 99,
      current: 750,
      maximum: 1_000,
      timeoutSeconds,
      modifier: 1.5,
      cooldownSeconds: 0, timeoutAt: 0, cooldownAt: 0,
      startedAt: 1_754_733_000,
      endedAt: 0,
      state: "active",
    },
    message: "Verified",
  };
}

const baseInput = {
  telemetry: telemetry(),
  report: null,
  reportAvailable: true,
  history: [],
  historyAvailable: true,
  roster: [],
  rosterAvailable: true,
};

describe("buildOperationsBrief", () => {
  it("prioritizes a critical timeout using the aged snapshot", () => {
    const brief = buildOperationsBrief({ ...baseInput, telemetry: telemetry(120) }, now + 31_000);
    expect(brief.state).toBe("critical");
    expect(brief.tone).toBe("danger");
    expect(brief.signals[0]?.value).toBe("1m 29s");
    expect(brief.action.href).toBe("/live-chain");
  });

  it("withholds recommendations when telemetry is unavailable", () => {
    const brief = buildOperationsBrief({
      ...baseInput,
      telemetry: { source: "unavailable", checkedAt, faction: null, chain: null, message: "Connect" },
      reportAvailable: false,
      historyAvailable: false,
      rosterAvailable: false,
    }, now);
    expect(brief.state).toBe("blocked");
    expect(brief.confidence.observed).toBe(0);
    expect(brief.action.href).toBe("/connect");
  });

  it("compares recent returned chains without extrapolating", () => {
    const brief = buildOperationsBrief({
      ...baseInput,
      history: [
        { id: 6, hits: 120, respect: 1, startedAt: 1, endedAt: 2 },
        { id: 5, hits: 120, respect: 1, startedAt: 1, endedAt: 2 },
        { id: 4, hits: 120, respect: 1, startedAt: 1, endedAt: 2 },
        { id: 3, hits: 100, respect: 1, startedAt: 1, endedAt: 2 },
        { id: 2, hits: 100, respect: 1, startedAt: 1, endedAt: 2 },
        { id: 1, hits: 100, respect: 1, startedAt: 1, endedAt: 2 },
      ],
    }, now);
    expect(brief.signals[3]?.value).toBe("+20%");
    expect(brief.confidence.label).toBe("Full signal coverage");
  });
});
