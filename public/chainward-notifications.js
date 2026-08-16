/* Chainward foreground monitoring uses this worker to surface reliable native
   notifications from visible or background browser tabs. */
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
