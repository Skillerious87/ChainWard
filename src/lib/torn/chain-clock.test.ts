import { describe, expect, it } from "vitest";
import { CLOCK_TOLERANCE_MS, reconcileDeadline, stabiliseRemaining } from "./chain-clock";

describe("countdown deadline reconciliation", () => {
  it("holds the current deadline through sync noise", () => {
    // Torn's Date header carries whole seconds, Torn may answer from its own
    // cache, and the round trip varies. Consecutive syncs therefore disagree by
    // a second or so with nothing having happened.
    const held = 1_800_000_000_000;
    expect(reconcileDeadline(held, held + 900)).toBe(held);
    expect(reconcileDeadline(held, held - 1_400)).toBe(held);
  });

  it("adopts a deadline that moved further than the tolerance", () => {
    const held = 1_800_000_000_000;
    // A hit restarts Torn's window, which is a real change worth showing.
    expect(reconcileDeadline(held, held + 240_000)).toBe(held + 240_000);
    expect(reconcileDeadline(held, held - CLOCK_TOLERANCE_MS)).toBe(held - CLOCK_TOLERANCE_MS);
  });

  it("takes any deadline when none is being counted down", () => {
    expect(reconcileDeadline(0, 1_800_000_000_000)).toBe(1_800_000_000_000);
  });

  it("adopts a cleared deadline immediately", () => {
    expect(reconcileDeadline(1_800_000_000_000, 0)).toBe(0);
  });
});

describe("countdown display stability", () => {
  it("always accepts a smaller remainder, so the timer keeps counting down", () => {
    expect(stabiliseRemaining(60_000, 59_750)).toBe(59_750);
    expect(stabiliseRemaining(60_000, 0)).toBe(0);
  });

  it("suppresses a small upward correction, which would read as the timer stalling or jumping back", () => {
    expect(stabiliseRemaining(60_000, 60_400)).toBe(60_000);
    expect(stabiliseRemaining(60_000, 61_999)).toBe(60_000);
  });

  it("accepts a large upward move, which is a genuine window reset", () => {
    expect(stabiliseRemaining(60_000, 300_000)).toBe(300_000);
    expect(stabiliseRemaining(60_000, 60_000 + CLOCK_TOLERANCE_MS)).toBe(60_000 + CLOCK_TOLERANCE_MS);
  });

  it("never emits a value that would make a ceiling-rounded label tick upward", () => {
    // Simulates repeated syncs each landing a few hundred milliseconds either
    // side of the truth: the visible label must only ever descend.
    let current = 45_000;
    const labels: number[] = [];
    for (let step = 0; step < 40; step += 1) {
      const drift = ((step % 5) - 2) * 300;
      current = stabiliseRemaining(current, Math.max(0, 45_000 - step * 1_000 + drift));
      labels.push(Math.ceil(current / 1_000));
    }
    for (let index = 1; index < labels.length; index += 1) {
      expect(labels[index]!).toBeLessThanOrEqual(labels[index - 1]!);
    }
  });
});
