/* ===========================================================================
   Edge Function: send-push
   Invia una notifica push a tutti gli iscritti (o a una persona specifica).

   Come si chiama (dal browser o da un altro servizio):
     POST https://<tuo-progetto>.functions.supabase.co/send-push
     Header: Authorization: Bearer <SUPABASE_ANON_KEY>
     Body JSON: { "title": "...", "body": "...", "url": "/", "personId": "opzionale" }

   Prerequisiti (vedi README_PWA.md):
   - variabili d'ambiente della function:
       VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (es. mailto:tu@mail.it)
       SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
   =========================================================================== */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { title, body, url, personId } = await req.json();

    const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );

    // legge le iscrizioni salvate dall'app (chiave "shared:push:subs")
    const { data } = await supabase
      .from("app_storage")
      .select("value")
      .eq("key", "shared:push:subs")
      .maybeSingle();

    const subsByPerson = data?.value ? JSON.parse(data.value) : {};

    // seleziona i destinatari
    let targets = [];
    if (personId && subsByPerson[personId]) {
      targets = subsByPerson[personId];
    } else {
      targets = Object.values(subsByPerson).flat();
    }

    const payload = JSON.stringify({
      title: title || "Turni Squadra",
      body: body || "Hai un aggiornamento sui turni.",
      url: url || "/",
    });

    let sent = 0;
    let failed = 0;
    await Promise.all(
      targets.map(async (subStr) => {
        try {
          const sub = typeof subStr === "string" ? JSON.parse(subStr) : subStr;
          await webpush.sendNotification(sub, payload);
          sent++;
        } catch (_e) {
          failed++;
        }
      })
    );

    return new Response(JSON.stringify({ sent, failed }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
