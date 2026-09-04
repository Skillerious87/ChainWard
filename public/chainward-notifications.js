/* Chainward's same-origin worker receives standards-based Web Push messages.
   A push event must always create a visible notification; silent background
   work is intentionally unsupported by browsers and by Chainward. */
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
