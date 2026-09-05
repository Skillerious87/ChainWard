import { describe, expect, it, vi } from "vitest";
import { normalizeTornProfileImageUrl } from "./profile-image";

describe("normalizeTornProfileImageUrl", () => {
  it("accepts secure Torn profile images and preserves their cache query", () => {
    expect(normalizeTornProfileImageUrl("https://profileimages.torn.com/avatar.gif?v=2"))
      .toBe("https://profileimages.torn.com/avatar.gif?v=2");
  });

  it("upgrades an insecure scheme on the same host instead of rejecting it", () => {
    expect(normalizeTornProfileImageUrl("http://profileimages.torn.com/avatar.png"))
      .toBe("https://profileimages.torn.com/avatar.png");
  });

  it("accepts a protocol-relative reference", () => {
    expect(normalizeTornProfileImageUrl("//profileimages.torn.com/avatar.png"))
      .toBe("https://profileimages.torn.com/avatar.png");
  });

  it("accepts a bare host-and-path with no scheme at all", () => {
    expect(normalizeTornProfileImageUrl("profileimages.torn.com/avatar.png"))
      .toBe("https://profileimages.torn.com/avatar.png");
  });

  it("rejects non-Torn hosts and malformed values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normalizeTornProfileImageUrl("https://attacker.example/avatar.png")).toBeNull();
    expect(normalizeTornProfileImageUrl("not a URL")).toBeNull();
    expect(normalizeTornProfileImageUrl(null)).toBeNull();
    expect(normalizeTornProfileImageUrl("")).toBeNull();
    warn.mockRestore();
  });
});
