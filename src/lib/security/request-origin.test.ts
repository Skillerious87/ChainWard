import { describe, expect, it } from "vitest";
import { isTrustedMutationRequest } from "./request-origin";

describe("mutation origin checks", () => {
  it("accepts same-origin browser requests", () => {
    const request = new Request("http://localhost:3000/api/test", { headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" } });
    expect(isTrustedMutationRequest(request)).toBe(true);
  });

  it("rejects cross-site browser requests even when the host is spoofed", () => {
    const request = new Request("http://localhost:3000/api/test", { headers: { origin: "https://attacker.example", host: "attacker.example", "sec-fetch-site": "cross-site" } });
    expect(isTrustedMutationRequest(request)).toBe(false);
  });

  it("keeps local scripts usable when browsers do not supply origin metadata", () => {
    expect(isTrustedMutationRequest(new Request("http://localhost:3000/api/test"))).toBe(true);
  });
});
