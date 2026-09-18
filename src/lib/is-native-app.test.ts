import { afterEach, describe, expect, it, vi } from "vitest";
import { isNativeApp } from "./is-native-app";

describe("isNativeApp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is false with no Capacitor global at all (a regular browser tab)", () => {
    expect(isNativeApp()).toBe(false);
  });

  it("is true inside the Capacitor Android shell", () => {
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
    expect(isNativeApp()).toBe(true);
  });

  it("is false when Capacitor reports a web platform", () => {
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => false } });
    expect(isNativeApp()).toBe(false);
  });

  it("is false rather than throwing if isNativePlatform itself throws", () => {
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => { throw new Error("boom"); } } });
    expect(isNativeApp()).toBe(false);
  });
});
