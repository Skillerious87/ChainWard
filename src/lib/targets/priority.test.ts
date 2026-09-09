import { describe, expect, it } from "vitest";
import { scoreTarget } from "./priority";
import type { TargetHitStats, TargetSnapshot } from "./types";

const NOW = 1_800_000_000_000;

function snap(over: Partial<TargetSnapshot> = {}): TargetSnapshot {
  return {
    tornUserId: 1,
    name: "T",
    level: 30,
    factionId: null,
    factionName: "",
    position: "",
    status: { description: "Okay", state: "Okay", until: null, color: "green" },
    lastActionAt: 0,
    lastActionRelative: "",
    lastActionStatus: "",
    lifeCurrent: 0,
    lifeMaximum: 0,
    attackable: true,
    lastHit: null,
    hitYouBack: false,
    hitStats: null,
    bountyTotal: 0,
    bountyCount: 0,
    fetchedAt: new Date(NOW).toISOString(),
    ...over,
  };
}

function hospital(minutesOut: number, over: Partial<TargetSnapshot> = {}): TargetSnapshot {
  return snap({
    status: { description: "In hospital", state: "Hospital", until: Math.round((NOW + minutesOut * 60_000) / 1_000), color: "red" },
    attackable: false,
    ...over,
  });
}

describe("scoreTarget", () => {
  it("ranks ready above clearing-soon above abroad", () => {
    const ready = scoreTarget({ snapshot: snap(), fairFight: null, pinned: false, now: NOW }).score;
    const soon = scoreTarget({ snapshot: hospital(5), fairFight: null, pinned: false, now: NOW }).score;
    const abroad = scoreTarget({
      snapshot: snap({ status: { description: "Travelling", state: "Traveling", until: null, color: "blue" }, attackable: false }),
      fairFight: null, pinned: false, now: NOW,
    }).score;
    expect(ready).toBeGreaterThan(soon);
    expect(soon).toBeGreaterThan(abroad);
  });

  it("prefers the easier fight when readiness is equal", () => {
    const easy = scoreTarget({ snapshot: snap(), fairFight: 1.4, pinned: false, now: NOW }).score;
    const hard = scoreTarget({ snapshot: snap(), fairFight: 4.8, pinned: false, now: NOW }).score;
    expect(easy).toBeGreaterThan(hard);
  });

  it("treats an unknown Fair Fight as neutral, behind a known-easy target", () => {
    const easy = scoreTarget({ snapshot: snap(), fairFight: 1.5, pinned: false, now: NOW }).score;
    const unknown = scoreTarget({ snapshot: snap(), fairFight: null, pinned: false, now: NOW }).score;
    const hard = scoreTarget({ snapshot: snap(), fairFight: 4.8, pinned: false, now: NOW }).score;
    expect(easy).toBeGreaterThan(unknown);
    expect(unknown).toBeGreaterThan(hard);
  });

  it("sinks a stale reading below a fresh one", () => {
    const fresh = scoreTarget({ snapshot: snap(), fairFight: 2, pinned: false, now: NOW }).score;
    const stale = scoreTarget({
      snapshot: snap({ fetchedAt: new Date(NOW - 20 * 60_000).toISOString() }),
      fairFight: 2, pinned: false, now: NOW,
    });
    expect(stale.score).toBeLessThan(fresh);
    expect(stale.reasons).toContain("Stale reading");
  });

  it("lets a pin boost a target without overtaking a ready unpinned one", () => {
    const readyUnpinned = scoreTarget({ snapshot: snap(), fairFight: 2, pinned: false, now: NOW }).score;
    const pinnedInHospital = scoreTarget({ snapshot: hospital(18), fairFight: null, pinned: true, now: NOW }).score;
    const unpinnedInHospital = scoreTarget({ snapshot: hospital(18), fairFight: null, pinned: false, now: NOW }).score;
    expect(pinnedInHospital).toBeGreaterThan(unpinnedInHospital);
    expect(pinnedInHospital).toBeLessThan(readyUnpinned);
  });

  it("rewards a bounty and surfaces it as a reason", () => {
    const plain = scoreTarget({ snapshot: snap(), fairFight: 3, pinned: false, now: NOW }).score;
    const bountied = scoreTarget({ snapshot: snap({ bountyTotal: 2_500_000, bountyCount: 1 }), fairFight: 3, pinned: false, now: NOW });
    expect(bountied.score).toBeGreaterThan(plain);
    expect(bountied.reasons).toContain("$2.5M bounty");
  });

  it("penalises a target that repeatedly hits back", () => {
    const stats: TargetHitStats = { hitCount: 4, respectTotal: 8, respectAvg: 2, winCount: 3, lossCount: 1, hitBackCount: 3, lastResult: "Attacked", windowStartAt: NOW / 1_000 - 400_000 };
    const calm = scoreTarget({ snapshot: snap(), fairFight: 2, pinned: false, now: NOW }).score;
    const retaliates = scoreTarget({ snapshot: snap({ hitStats: stats }), fairFight: 2, pinned: false, now: NOW });
    expect(retaliates.score).toBeLessThan(calm);
    expect(retaliates.reasons).toContain("Hits back often");
  });

  it("flags a reliable farm and scores it above an unproven equal", () => {
    const farmStats: TargetHitStats = { hitCount: 6, respectTotal: 24, respectAvg: 4, winCount: 6, lossCount: 0, hitBackCount: 0, lastResult: "Hospitalized", windowStartAt: NOW / 1_000 - 500_000 };
    const proven = scoreTarget({ snapshot: snap({ hitStats: farmStats, lastHit: { at: NOW / 1_000 - 5 * 86_400, result: "Hospitalized", respect: 4 } }), fairFight: 2, pinned: false, now: NOW });
    const unproven = scoreTarget({ snapshot: snap({ lastHit: { at: NOW / 1_000 - 5 * 86_400, result: "Hospitalized", respect: 4 } }), fairFight: 2, pinned: false, now: NOW }).score;
    expect(proven.reasons).toContain("Reliable farm");
    expect(proven.score).toBeGreaterThan(unproven);
  });

  it("returns a zero score with no reasons when there is no snapshot", () => {
    expect(scoreTarget({ snapshot: null, fairFight: null, pinned: false, now: NOW })).toEqual({ score: 0, reasons: [] });
  });
});
