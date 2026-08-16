// Minimal offline shell: cache the app frame, always hit the network for data.
/*
 * Bump this on any deploy that changes the shell.
 *
 * It sat at v2 through a day of deploys, so installed PWAs kept booting a cached
 * "/" that referenced the previous CSS bundle — which still exists on the CDN,
 * so it was served happily and every fix looked like it had not shipped. The
 * activate handler deletes every cache that is not this one.
 */
const CACHE = "hyrox-v3";
const SHELL = ["/", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r ?? caches.match("/"))),
  );
});

// ---------------------------------------------------------------- push
self.addEventListener("push", (e) => {
  // iOS requires that every push shows a notification — a silent one gets the
  // subscription revoked — so there is deliberately no early return here.
  let d = { title: "Split", body: "", url: "/" };
  try {
    if (e.data) d = { ...d, ...e.data.json() };
  } catch {
    if (e.data) d.body = e.data.text();
  }
  e.waitUntil(
    self.registration.showNotification(d.title, {
      body: d.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // same tag replaces rather than stacks: three "they trained" in a row
      // should be one line in the shade, not three
      tag: d.tag || "split",
      data: { url: d.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // focus the app if it is already open rather than opening a second copy
      for (const c of list) {
        if (c.url.includes(self.registration.scope) && "focus" in c) {
          c.navigate(target);
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
