import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import OpenGraphImage, { alt as openGraphAlt, contentType as openGraphType, size as openGraphSize } from "./opengraph-image";
import TwitterImage, { alt as twitterAlt, contentType as twitterType, size as twitterSize } from "./twitter-image";

const sourceImage = readFile(path.join(process.cwd(), "public", "og.png"));

describe("social preview images", () => {
  it.each([
    ["Open Graph", OpenGraphImage, openGraphAlt, openGraphType, openGraphSize],
    ["Twitter", TwitterImage, twitterAlt, twitterType, twitterSize],
  ] as const)("serves public/og.png through the %s metadata convention", async (_name, render, alt, contentType, size) => {
    const [source, response] = await Promise.all([sourceImage, render()]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const responseImage = Buffer.from(await response.arrayBuffer());
    expect(responseImage).toEqual(source);
    expect({ width: responseImage.readUInt32BE(16), height: responseImage.readUInt32BE(20) }).toEqual({ width: 1200, height: 630 });
    expect({ alt, contentType, size }).toEqual({
      alt: "Chainward — faction chain operations, clearly organised.",
      contentType: "image/png",
      size: { width: 1200, height: 630 },
    });
  }, 15_000);
});
