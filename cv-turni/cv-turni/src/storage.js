import { createClient } from "@supabase/supabase-js";

/* ===========================================================================
   Aggancio del salvataggio condiviso a Supabase.

   Questo file installa `window.storage` con LO STESSO identico contratto che
   il componente TurniSquadra.jsx già usa:

     await window.storage.get(key, shared)     -> { key, value, shared } | null
     await window.storage.set(key, value, shared) -> { key, value, shared } | null
     await window.storage.list(prefix, shared) -> { keys, shared }
     await window.storage.delete(key, shared)  -> { key, deleted, shared }

   Così NON devi toccare il componente: lo copi dentro così com'è.

   I dati vengono salvati in una tabella Supabase chiamata `app_storage`
   (lo schema è in supabase_schema.sql). Tutti i dati dell'app sono "condivisi"
   (shared = true), cioè visibili a tutta la squadra: è esattamente ciò che serve.
   =========================================================================== */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Messaggio chiaro in console se mancano le chiavi (vedi README, passo 3)
  console.error(
    "[Turni Squadra] Mancano le chiavi di Supabase. " +
      "Crea un file .env (vedi .env.example) con VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY."
  );
}

const supabase = createClient(SUPABASE_URL || "", SUPABASE_ANON_KEY || "");

const TABLE = "app_storage";

// Prefisso per separare i dati "condivisi" da eventuali dati personali.
// L'app usa sempre shared = true, quindi in pratica tutto finisce sotto "shared:".
function fullKey(key, shared) {
  return `${shared ? "shared" : "personal"}:${key}`;
}

const storage = {
  async get(key, shared = false) {
    const k = fullKey(key, shared);
    const { data, error } = await supabase
      .from(TABLE)
      .select("value")
      .eq("key", k)
      .maybeSingle();
    if (error) {
      console.warn("[storage.get]", error.message);
      return null;
    }
    if (!data) return null;
    return { key, value: data.value, shared };
  },

  async set(key, value, shared = false) {
    const k = fullKey(key, shared);
    const { error } = await supabase
      .from(TABLE)
      .upsert({ key: k, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) {
      console.warn("[storage.set]", error.message);
      return null;
    }
    return { key, value, shared };
  },

  async list(prefix = "", shared = false) {
    const k = fullKey(prefix, shared);
    const { data, error } = await supabase
      .from(TABLE)
      .select("key")
      .like("key", `${k}%`);
    if (error) {
      console.warn("[storage.list]", error.message);
      return { keys: [], prefix, shared };
    }
    const strip = `${shared ? "shared" : "personal"}:`;
    const keys = (data || []).map((row) => row.key.slice(strip.length));
    return { keys, prefix, shared };
  },

  async delete(key, shared = false) {
    const k = fullKey(key, shared);
    const { error } = await supabase.from(TABLE).delete().eq("key", k);
    if (error) {
      console.warn("[storage.delete]", error.message);
      return { key, deleted: false, shared };
    }
    return { key, deleted: true, shared };
  },
};

// Installa il contratto globale usato dal componente.
if (typeof window !== "undefined") {
  window.storage = storage;
}

export default storage;
