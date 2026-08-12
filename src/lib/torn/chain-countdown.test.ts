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

  it("adopts a lower bound in full, because it is strictly better information", () => {
    // Every reading is an upper bound: Torn's cache means a figure can only be
    // too high, never too low. Holding the higher one would overstate the time
    // left, which is the dangerous direction for a chain timer.
    const next = reconcileAnchor(anchor, 102_000, 10_000);
    expect(project(next, 10_000)).toBe(102_000);
  });

  it("settles onto the lowest bound and stays there", () => {
    let current = createAnchor(120_000, 0);
    let previous = project(current, 0);
    for (let sync = 1; sync <= 6; sync += 1) {
      const at = sync * 10_000;
      // Truth runs 8s behind what the first reading implied.
      current = reconcileAnchor(current, 120_000 - at - 8_000, at);
      const shown = project(current, at);
      expect(shown).toBeLessThanOrEqual(previous);
      previous = shown;
    }
    expect(project(current, 60_000)).toBe(120_000 - 60_000 - 8_000);
  });

  it("holds its bound when a staler reading arrives afterwards", () => {
    // A later fetch can land earlier in Torn's cache cycle and report more time
    // than the reading already held. That is staleness, not news.
    let current = createAnchor(120_000, 0);
    current = reconcileAnchor(current, 100_000, 10_000);
    current = reconcileAnchor(current, 104_000, 10_000);
    expect(project(current, 10_000)).toBe(100_000);
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
