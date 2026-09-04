import { describe, expect, it } from "vitest";
import { normalizeTornProfileImageUrl } from "./profile-image";

describe("normalizeTornProfileImageUrl", () => {
  it("accepts secure Torn profile images and preserves their cache query", () => {
    expect(normalizeTornProfileImageUrl("https://profileimages.torn.com/avatar.gif?v=2"))
      .toBe("https://profileimages.torn.com/avatar.gif?v=2");
  });

  it("rejects non-Torn, insecure, and malformed image locations", () => {
    expect(normalizeTornProfileImageUrl("https://attacker.example/avatar.png")).toBeNull();
    expect(normalizeTornProfileImageUrl("http://profileimages.torn.com/avatar.png")).toBeNull();
    expect(normalizeTornProfileImageUrl("not a URL")).toBeNull();
    expect(normalizeTornProfileImageUrl(null)).toBeNull();
  });
});
