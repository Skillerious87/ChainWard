import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("Chainward web app manifest", () => {
  it("publishes installable standard and Android-safe icons", () => {
    const value = manifest();

    expect(value.name).toBe("Chainward");
    expect(value.display).toBe("standalone");
    expect(value.start_url).toBe("/dashboard");
    expect(value.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ sizes: "192x192", purpose: "maskable" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
      ]),
    );
  });
});
