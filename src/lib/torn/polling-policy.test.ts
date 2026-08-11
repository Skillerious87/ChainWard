import { describe, expect, it } from "vitest";
import {
  ACTIVE_CHAIN_POLL_SECONDS,
  CHAIN_CACHE_SECONDS,
  MIN_POLL_SECONDS,
  pollSecondsForChain,
  safePollSeconds,
} from "./polling-policy";

describe("chain polling policy", () => {
  it("keeps the cache shorter than the active cadence", () => {
    // Equal windows meant a poll could land while the previous response was
    // still valid, so Torn was really only reached every other interval and a
    // hit that restarted the timeout went unnoticed for up to twice as long.
    expect(CHAIN_CACHE_SECONDS).toBeLessThan(ACTIVE_CHAIN_POLL_SECONDS);
  });

  it("never polls faster than Torn's documented floor", () => {
    expect(ACTIVE_CHAIN_POLL_SECONDS).toBeGreaterThanOrEqual(MIN_POLL_SECONDS);
    expect(CHAIN_CACHE_SECONDS).toBeGreaterThanOrEqual(MIN_POLL_SECONDS);
  });

  it("clamps a too-eager request up to the floor", () => {
    expect(safePollSeconds(1)).toBe(MIN_POLL_SECONDS);
    expect(safePollSeconds(0)).toBe(ACTIVE_CHAIN_POLL_SECONDS);
    expect(safePollSeconds(Number.NaN)).toBe(ACTIVE_CHAIN_POLL_SECONDS);
    expect(safePollSeconds(-30)).toBe(ACTIVE_CHAIN_POLL_SECONDS);
  });

  it("leaves a slower saved preference alone", () => {
    expect(safePollSeconds(120)).toBe(120);
  });

  it("tightens the cadence while a chain runs and restores it when idle", () => {
    expect(pollSecondsForChain(true, 120)).toBe(ACTIVE_CHAIN_POLL_SECONDS);
    expect(pollSecondsForChain(false, 120)).toBe(120);
  });

  it("respects a preference already faster than the active cadence", () => {
    expect(pollSecondsForChain(true, 5)).toBe(5);
    expect(pollSecondsForChain(false, 5)).toBe(5);
  });

  it("still refuses to go below the floor for an active chain", () => {
    expect(pollSecondsForChain(true, 1)).toBe(MIN_POLL_SECONDS);
  });
});
