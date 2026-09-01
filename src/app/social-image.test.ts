import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import OpenGraphImage, { alt as openGraphAlt, contentType as openGraphType, size as openGraphSize } from "./opengraph-image";
import TwitterImage, { alt as twitterAlt, contentType as twitterType, size as twitterSize } from "./twitter-image";

describe("social preview images", () => {
  it.each([
    ["Open Graph", OpenGraphImage, openGraphAlt, openGraphType, openGraphSize],
    ["Twitter", TwitterImage, twitterAlt, twitterType, twitterSize],
  ] as const)("serves public/og.png through the %s metadata convention", async (_name, render, alt, contentType, size) => {
    const source = await readFile(path.join(process.cwd(), "public", "og.png"));
    const response = await render();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(source);
    expect({ alt, contentType, size }).toEqual({
      alt: "Chainward — faction chain operations, clearly organised.",
      contentType: "image/png",
      size: { width: 1200, height: 630 },
    });
  });
});
