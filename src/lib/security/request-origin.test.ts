import { afterEach, describe, expect, it } from "vitest";
import { isTrustedMutationRequest } from "./request-origin";

describe("mutation origin checks", () => {
  const previousAllowedOrigins = process.env.CHAINWARD_ALLOWED_ORIGINS;

  afterEach(() => {
    if (previousAllowedOrigins === undefined) delete process.env.CHAINWARD_ALLOWED_ORIGINS;
    else process.env.CHAINWARD_ALLOWED_ORIGINS = previousAllowedOrigins;
  });

  it("accepts same-origin browser requests", () => {
    const request = new Request("http://localhost:3000/api/test", { headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" } });
    expect(isTrustedMutationRequest(request)).toBe(true);
  });

  it("rejects cross-site browser requests even when the host is spoofed", () => {
    const request = new Request("http://localhost:3000/api/test", { headers: { origin: "https://attacker.example", host: "attacker.example", "sec-fetch-site": "cross-site" } });
    expect(isTrustedMutationRequest(request)).toBe(false);
  });

  it("does not trust spoofable forwarded host headers", () => {
    const request = new Request("http://internal:3000/api/test", { headers: { origin: "https://attacker.example", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https", "sec-fetch-site": "same-site" } });
    expect(isTrustedMutationRequest(request)).toBe(false);
  });

  it("accepts an explicitly configured public proxy origin", () => {
    process.env.CHAINWARD_ALLOWED_ORIGINS = "https://chainward.example";
    const request = new Request("http://internal:3000/api/test", { headers: { origin: "https://chainward.example", "sec-fetch-site": "same-origin" } });
    expect(isTrustedMutationRequest(request)).toBe(true);
  });

  it("keeps local scripts usable when browsers do not supply origin metadata", () => {
    expect(isTrustedMutationRequest(new Request("http://localhost:3000/api/test"))).toBe(true);
  });
});
