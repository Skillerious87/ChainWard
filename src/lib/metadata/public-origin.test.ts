import { describe, expect, it } from "vitest";
import { deploymentOrigin } from "./public-origin";

describe("deploymentOrigin", () => {
  it("prefers an explicitly configured canonical origin", () => {
    expect(deploymentOrigin({
      CHAINWARD_PUBLIC_ORIGIN: "https://chainward.example/",
      VERCEL_PROJECT_PRODUCTION_URL: "fallback.vercel.app",
    })).toEqual(new URL("https://chainward.example/"));
  });

  it("uses Vercel's trusted production-domain variable as a fallback", () => {
    expect(deploymentOrigin({
      VERCEL_PROJECT_PRODUCTION_URL: "chain-ward-ebon.vercel.app",
    })).toEqual(new URL("https://chain-ward-ebon.vercel.app/"));
  });

  it("rejects origins containing credentials, paths, or malformed Vercel hosts", () => {
    expect(deploymentOrigin({ CHAINWARD_PUBLIC_ORIGIN: "https://user@example.com/" })).toBeUndefined();
    expect(deploymentOrigin({ CHAINWARD_PUBLIC_ORIGIN: "https://example.com/app" })).toBeUndefined();
    expect(deploymentOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "example.com/path" })).toBeUndefined();
  });
});
