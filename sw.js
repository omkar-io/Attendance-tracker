const CACHE = "ledger-v1";
const SHELL = ["./", "css/style.css", "css/extras.css", "js/app.js", "js/extras.js", "js/config.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // never cache Supabase calls
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
self.addEventListener("push", e => {
  const d = e.data ? e.data.json() : { title: "The Ledger", body: "Time to mark attendance." };
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "ledger-reminder" }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window" }).then(ws => ws.length ? ws[0].focus() : clients.openWindow("./")));
});
