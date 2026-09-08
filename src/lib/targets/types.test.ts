import { describe, expect, it } from "vitest";
import { normaliseTag, parseTornUserId, parseTornUserIdList } from "./types";

describe("parseTornUserId", () => {
  it("accepts a bare numeric ID", () => {
    expect(parseTornUserId("1234567")).toBe(1_234_567);
    expect(parseTornUserId("  1234567  ")).toBe(1_234_567);
  });

  it("accepts a profile URL or query fragment", () => {
    expect(parseTornUserId("https://www.torn.com/profiles.php?XID=1234567")).toBe(1_234_567);
    expect(parseTornUserId("profiles.php?XID=1234567")).toBe(1_234_567);
    expect(parseTornUserId("torn.com/profiles.php?xid=1234567&foo=bar")).toBe(1_234_567);
  });

  it("accepts the attack-loader link this feature's own Attack buttons generate", () => {
    expect(parseTornUserId("https://www.torn.com/loader.php?sid=attack&user2ID=1234567")).toBe(1_234_567);
    expect(parseTornUserId("loader.php?sid=attack&user2id=1234567")).toBe(1_234_567);
  });

  it("rejects zero, non-numeric, and unrelated input", () => {
    expect(parseTornUserId("0")).toBeNull();
    expect(parseTornUserId("abc")).toBeNull();
    expect(parseTornUserId("")).toBeNull();
    expect(parseTornUserId("https://www.torn.com/factions.php?step=your")).toBeNull();
  });
});

describe("parseTornUserIdList", () => {
  it("splits on whitespace, commas, and semicolons, de-duplicating", () => {
    expect(parseTornUserIdList("1,2; 3\n4 4")).toEqual([1, 2, 3, 4]);
  });

  it("parses a mix of bare IDs, profile links, and attack links", () => {
    expect(parseTornUserIdList([
      "1234567",
      "https://www.torn.com/profiles.php?XID=2345678",
      "https://www.torn.com/loader.php?sid=attack&user2ID=3456789",
    ].join("\n"))).toEqual([1_234_567, 2_345_678, 3_456_789]);
  });

  it("ignores tokens that don't resolve to an ID", () => {
    expect(parseTornUserIdList("1234567, not-an-id, 0")).toEqual([1_234_567]);
  });
});

describe("normaliseTag", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normaliseTag("  War  Target ")).toBe("war target");
  });

  it("strips characters outside the allowed set", () => {
    expect(normaliseTag("farm!!")).toBe("farm");
  });

  it("returns null when nothing usable remains", () => {
    expect(normaliseTag("   ")).toBeNull();
    expect(normaliseTag("!!!")).toBeNull();
  });
});
