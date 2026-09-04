/* Chainward's same-origin worker receives standards-based Web Push messages.
   A push event must always create a visible notification; silent background
   work is intentionally unsupported by browsers and by Chainward. It also
   caches the signed-in member's own Torn profile image on-device (see the
   fetch handler below) so the avatar survives a flaky Torn CDN and loads
   instantly on repeat visits. */
const AVATAR_CACHE_NAME = "chainward-avatar-cache-v1";
const AVATAR_IMAGE_HOST = "profileimages.torn.com";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Takes control of already-open tabs immediately, so a member does not
  // need to reload once before their avatar starts being cached.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  let requestUrl;
  try { requestUrl = new URL(request.url); } catch { return; }
  if (requestUrl.hostname !== AVATAR_IMAGE_HOST) return;
  event.respondWith(respondWithCachedAvatar(request));
});

/* Torn's avatar CDN sends no CORS headers, so a page script can only ever
   fetch these images as opaque, unreadable responses. Caching them here,
   where the response is handed straight back to the <img> element instead
   of into script, is the only place that works. Only one identity is ever
   signed in per browser, so any entry in this cache is that member's own
   avatar -- safe to serve as a last-known-good image if Torn's CDN is
   briefly unreachable for a newer, not-yet-cached version of it. */
async function respondWithCachedAvatar(request) {
  const cache = await caches.open(AVATAR_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    await cache.put(request, response.clone());
    await pruneAvatarCache(cache, request.url);
    return response;
  } catch (error) {
    const lastKnownGood = await mostRecentCacheEntry(cache);
    if (lastKnownGood) return lastKnownGood;
    throw error;
  }
}

async function pruneAvatarCache(cache, keepUrl) {
  const keys = await cache.keys();
  await Promise.all(keys.filter((key) => key.url !== keepUrl).map((key) => cache.delete(key)));
}

async function mostRecentCacheEntry(cache) {
  const keys = await cache.keys();
  const lastKey = keys.at(-1);
  return lastKey ? cache.match(lastKey) : undefined;
}

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = typeof payload.title === "string" && payload.title.trim()
    ? payload.title.slice(0, 120)
    : "Chainward alert";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 300) : "Open Chainward for the latest operational status.";
  const tag = typeof payload.tag === "string" ? payload.tag.slice(0, 120) : "chainward-alert";
  const url = safeRelativeUrl(payload.url);
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/icons/android-chrome-192x192.png",
    badge: "/icons/favicon-32x32.png",
    tag,
    renotify: true,
    requireInteraction: payload.requireInteraction === true,
    vibrate: payload.critical === true ? [220, 120, 220, 120, 320] : [160],
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requested = typeof event.notification.data?.url === "string"
    ? event.notification.data.url
    : "/members";
  const target = new URL(requested, self.location.origin);
  const safeTarget = target.origin === self.location.origin ? target.href : `${self.location.origin}/members`;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.navigate(safeTarget);
        return client.focus();
      }
    }
    return self.clients.openWindow(safeTarget);
  })());
});

function safeRelativeUrl(value) {
  if (typeof value !== "string") return "/dashboard";
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? `${url.pathname}${url.search}${url.hash}` : "/dashboard";
  } catch {
    return "/dashboard";
  }
}
