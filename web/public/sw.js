// SPDX-License-Identifier: Apache-2.0
// The service worker exists only so the GUI can be installed (Add to Home Screen, the app
// badge, notifications on Android). It caches nothing: every request, the API and the
// pages alike, reaches the network exactly as it would without it.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Installability wants a fetch handler; an empty one never answers a request itself, so
// the browser skips it and the network does.
self.addEventListener("fetch", () => {});

// A tap on a notification shown through this registration: focus an open tab on the inbox,
// or open one.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/inbox", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const win = list.find((w) => "focus" in w);
      if (!win) return self.clients.openWindow(url);
      return win.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : w));
    }),
  );
});
