/* ===========================================================================
   Service Worker — Turni Squadra
   - Rende l'app installabile e utilizzabile anche con rete debole (cache shell)
   - Riceve le notifiche push e le mostra
   =========================================================================== */

const CACHE = "cv-turni-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Strategia di rete:
   - le chiamate a Supabase (dati) vanno SEMPRE in rete (network-first, no cache)
   - il resto (shell dell'app) usa cache-first con fallback rete */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.hostname.endsWith("supabase.co")) return; // dati sempre freschi

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/index.html"));
    })
  );
});

/* Notifiche push: il server invia un payload JSON { title, body, url } */
self.addEventListener("push", (event) => {
  let data = { title: "Turni Squadra", body: "Hai un aggiornamento sui turni.", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" },
      vibrate: [80, 40, 80],
    })
  );
});

/* Al tap sulla notifica: apre/porta in primo piano l'app */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
