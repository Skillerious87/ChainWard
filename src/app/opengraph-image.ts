import { readFile } from "node:fs/promises";
import path from "node:path";

export const alt = "Chainward — faction chain operations, clearly organised.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage(): Promise<Response> {
  const image = await readFile(path.join(process.cwd(), "public", "og.png"));
  return new Response(Uint8Array.from(image), {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
