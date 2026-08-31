import type { Route } from "next";

type ReplaceDocument = (path: Route) => void;
type ScheduleNavigation = (navigate: () => void) => void;

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
  scheduleNavigation: ScheduleNavigation = (navigate) => window.requestAnimationFrame(navigate),
): void {
  // Give React one paint opportunity to mount the document-level handoff
  // before the full navigation begins. The current document then keeps that
  // handoff visible until the authenticated response is ready to render.
  scheduleNavigation(() => replaceDocument(path));
}
