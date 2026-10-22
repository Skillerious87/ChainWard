import type { Route } from "next";

type ReplaceDocument = (path: Route) => void;

/**
 * Crossing the connection boundary must make a new document request. The
 * installed app starts at `/dashboard`, so an unauthenticated launch can leave
 * a redirect to `/connect` in Next's client navigation cache. Replacing the
 * document guarantees the server sees the newly stored HttpOnly session cookie
 * instead of reusing that guest response.
 */
export function enterConnectedWorkspace(
  path: Route,
  replaceDocument: ReplaceDocument = (destination) => window.location.replace(destination),
): void {
  replaceDocument(path);
}
