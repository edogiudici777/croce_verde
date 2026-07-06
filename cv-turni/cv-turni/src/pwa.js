/* ===========================================================================
   PWA + Notifiche — lato client
   - registra il service worker
   - offre funzioni per attivare le notifiche push e iscriversi
   Le funzioni sono esportate così l'app può chiamarle da un pulsante.
   =========================================================================== */

import storage from "./storage.js";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

// Registra il service worker (chiamata all'avvio dell'app)
export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    return reg;
  } catch (e) {
    console.warn("[PWA] registrazione service worker fallita:", e);
    return null;
  }
}

// L'utente ha già dato il permesso notifiche?
export function notificationsGranted() {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

// Le notifiche push sono supportate su questo dispositivo?
export function pushSupported() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/* Chiede il permesso e iscrive il dispositivo alle push.
   Salva l'iscrizione nel database (chiave condivisa "push:subs") così il
   server sa a chi mandare le notifiche.
   Ritorna { ok, reason } */
export async function enablePush(personId) {
  if (!pushSupported()) return { ok: false, reason: "non-supportato" };
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: "manca-vapid" };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "permesso-negato" };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  // salva l'iscrizione nel database, indicizzata per persona
  try {
    const existing = (await storage.get("push:subs", true))?.value;
    const subs = existing ? JSON.parse(existing) : {};
    subs[personId || "anon"] = subs[personId || "anon"] || [];
    const json = JSON.stringify(sub);
    if (!subs[personId || "anon"].includes(json)) {
      subs[personId || "anon"].push(json);
    }
    await storage.set("push:subs", JSON.stringify(subs), true);
  } catch (e) {
    console.warn("[PWA] impossibile salvare l'iscrizione push:", e);
  }

  return { ok: true };
}

// Chiede al server (Edge Function) di inviare una notifica push.
// Non blocca l'app se fallisce: le notifiche sono un extra.
export async function sendPush({ title, body, url, personId }) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key) return { ok: false };
  const fnUrl = base.replace(".supabase.co", ".functions.supabase.co") + "/send-push";
  try {
    const res = await fetch(fnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ title, body, url, personId }),
    });
    return { ok: res.ok };
  } catch (e) {
    console.warn("[PWA] invio push fallito:", e);
    return { ok: false };
  }
}

// Mostra una notifica LOCALE immediata (utile per test, senza server)
export async function showLocalNotification(title, body) {
  if (!notificationsGranted()) {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return false;
  }
  const reg = await navigator.serviceWorker.ready;
  reg.showNotification(title, {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
  });
  return true;
}
