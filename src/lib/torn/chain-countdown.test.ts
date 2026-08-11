import { describe, expect, it } from "vitest";
import {
  anchorFromReading,
  createAnchor,
  displaySeconds,
  NOISE_TOLERANCE_MS,
  project,
  reconcileAnchor,
  RESET_THRESHOLD_MS,
} from "./chain-countdown";

describe("anchoring a countdown to a server reading", () => {
  it("subtracts how stale the reading is and how long it took to arrive", () => {
    // Torn said 300s remained, the server had held that response for 4s, and
    // the payload took 200ms to reach the browser.
    const anchor = anchorFromReading(300_000, 4_000, 200, 1_000);
    expect(anchor.remainingMs).toBe(295_800);
    expect(anchor.atPerf).toBe(1_000);
  });

  it("never produces a negative remainder", () => {
    expect(anchorFromReading(1_000, 9_000, 500, 0).remainingMs).toBe(0);
  });

  it("ignores nonsensical negative staleness", () => {
    expect(anchorFromReading(300_000, -5_000, 0, 0).remainingMs).toBe(300_000);
  });
});

describe("projecting with a monotonic clock", () => {
  it("counts down as the monotonic clock advances", () => {
    const anchor = createAnchor(300_000, 5_000);
    expect(project(anchor, 5_000)).toBe(300_000);
    expect(project(anchor, 65_000)).toBe(240_000);
  });

  it("floors at zero rather than going negative", () => {
    expect(project(createAnchor(1_000, 0), 10_000)).toBe(0);
  });

  it("is unaffected by the wall clock, which a monotonic reading cannot follow", () => {
    // The whole point: no `Date.now()` appears anywhere in the projection, so a
    // user changing their system clock cannot move the countdown.
    const anchor = createAnchor(120_000, 1_000);
    expect(project(anchor, 61_000)).toBe(60_000);
  });
});

describe("reconciling a new reading", () => {
  const anchor = createAnchor(120_000, 0);

  it("adopts a large increase, which is a hit restarting the window", () => {
    const next = reconcileAnchor(anchor, 300_000, 10_000);
    expect(project(next, 10_000)).toBe(300_000);
  });

  it("ignores a small increase rather than letting the timer tick upward", () => {
    // Projected 110s, Torn says 111.2s. Running marginally fast is invisible;
    // a countdown that goes up reads as broken.
    const next = reconcileAnchor(anchor, 111_200, 10_000);
    expect(project(next, 10_000)).toBe(110_000);
  });

  it("ignores a small decrease as sync noise", () => {
    const next = reconcileAnchor(anchor, 109_000, 10_000);
    expect(project(next, 10_000)).toBe(110_000);
  });

  it("corrects a real drift only a fraction at a time", () => {
    // Eight seconds adrift: a quarter is taken now, so nothing visibly jumps.
    const next = reconcileAnchor(anchor, 102_000, 10_000);
    expect(project(next, 10_000)).toBe(108_000);
  });

  it("converges on repeated syncs without ever stepping", () => {
    let current = createAnchor(120_000, 0);
    let previous = project(current, 0);
    for (let sync = 1; sync <= 6; sync += 1) {
      const at = sync * 10_000;
      // Truth runs 8s behind what the anchor believes.
      current = reconcileAnchor(current, 120_000 - at - 8_000, at);
      const shown = project(current, at);
      expect(shown).toBeLessThanOrEqual(previous);
      previous = shown;
    }
    // Correcting a quarter of the gap each sync closes it geometrically, and
    // the last stretch is left alone once it falls inside the noise tolerance —
    // chasing further would only reintroduce the twitching this avoids.
    const truth = 120_000 - 60_000 - 8_000;
    expect(Math.abs(project(current, 60_000) - truth)).toBeLessThan(NOISE_TOLERANCE_MS);
  });

  it("never lets the displayed label tick upward across a noisy run", () => {
    let current = createAnchor(300_000, 0);
    const labels: number[] = [displaySeconds(project(current, 0))];
    for (let step = 1; step <= 120; step += 1) {
      const at = step * 1_000;
      if (step % 10 === 0) {
        const jitter = ((step / 10) % 5 - 2) * 700;
        current = reconcileAnchor(current, 300_000 - at + jitter, at);
      }
      labels.push(displaySeconds(project(current, at)));
    }
    for (let index = 1; index < labels.length; index += 1) {
      expect(labels[index]!).toBeLessThanOrEqual(labels[index - 1]!);
    }
  });

  it("still adopts a reset that lands during a noisy run", () => {
    let current = createAnchor(40_000, 0);
    current = reconcileAnchor(current, 39_400, 1_000);
    current = reconcileAnchor(current, 300_000, 2_000);
    expect(displaySeconds(project(current, 2_000))).toBe(300);
  });

  it("treats the thresholds as documented", () => {
    const base = createAnchor(100_000, 0);
    expect(project(reconcileAnchor(base, 100_000 + RESET_THRESHOLD_MS, 0), 0)).toBe(100_000 + RESET_THRESHOLD_MS);
    expect(project(reconcileAnchor(base, 100_000 - NOISE_TOLERANCE_MS, 0), 0)).toBe(100_000);
  });
});

describe("display rounding", () => {
  it("shows each whole second for its full duration and reaches zero at the deadline", () => {
    expect(displaySeconds(10_000)).toBe(10);
    expect(displaySeconds(9_001)).toBe(10);
    expect(displaySeconds(9_000)).toBe(9);
    expect(displaySeconds(1)).toBe(1);
    expect(displaySeconds(0)).toBe(0);
  });
});
