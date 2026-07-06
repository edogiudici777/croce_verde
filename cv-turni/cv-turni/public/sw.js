/* ===========================================================================
   Service Worker — Turni Squadra (v2, network-first)
   - Rende l'app installabile sulla schermata Home
   - Prende SEMPRE la versione fresca dalla rete (niente più schermate nere
     agli aggiornamenti). La cache serve solo come rete di sicurezza offline.
   =========================================================================== */

const CACHE = "cv-turni-v2";

self.addEventListener("install", (event) => {
  // attiva subito la nuova versione senza aspettare
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // cancella TUTTE le cache vecchie (comprese quelle della v1 che davano lo schermo nero)
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)));
      await self.clients.claim();
    })()
  );
});

/* Strategia NETWORK-FIRST:
   - prova sempre la rete (così il codice è sempre l'ultimo pubblicato)
   - salva una copia in cache
   - usa la cache SOLO se la rete non è disponibile (offline vero)
   - le chiamate a Supabase (dati) passano sempre e solo dalla rete */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return; // dati sempre freschi, mai in cache

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(async () => {
        // rete assente: prova la cache, poi la home come ultima risorsa
        const cached = await caches.match(req);
        return cached || caches.match("/index.html");
      })
  );
});

/* Notifiche push (restano per il futuro, non usate ora) */
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
