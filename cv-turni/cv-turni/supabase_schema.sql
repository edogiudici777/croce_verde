-- ===========================================================================
-- SCHEMA DATABASE — Turni Squadra Croceverde APM
--
-- Cosa fa: crea una tabella "app_storage" che funziona come un semplice
-- deposito chiave -> valore (JSON). L'app salva qui dentro tutto:
-- persone, disponibilità, equipaggi, cambusa, alert, pubblicazioni.
--
-- COME USARLO:
-- 1. Vai su supabase.com -> apri il tuo progetto
-- 2. Menu a sinistra: "SQL Editor" -> "New query"
-- 3. Incolla TUTTO questo file e premi "Run"
-- ===========================================================================

create table if not exists public.app_storage (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Abilita la Row Level Security (richiesto da Supabase)
alter table public.app_storage enable row level security;

-- ---------------------------------------------------------------------------
-- PERMESSI
--
-- Versione semplice (consigliata per iniziare): chiunque abbia il link
-- dell'app puo' leggere e scrivere. La protezione vera e' il PIN del
-- caposquadra nell'app + il fatto che il link non e' pubblicizzato.
-- Va benissimo per una squadra di volontari.
--
-- Se in futuro vuoi piu' sicurezza, vedi la sezione "VERSIONE PROTETTA"
-- in fondo (richiede il login utenti di Supabase).
-- ---------------------------------------------------------------------------

drop policy if exists "accesso aperto lettura" on public.app_storage;
drop policy if exists "accesso aperto scrittura" on public.app_storage;
drop policy if exists "accesso aperto modifica" on public.app_storage;
drop policy if exists "accesso aperto cancellazione" on public.app_storage;

create policy "accesso aperto lettura"
  on public.app_storage for select
  using (true);

create policy "accesso aperto scrittura"
  on public.app_storage for insert
  with check (true);

create policy "accesso aperto modifica"
  on public.app_storage for update
  using (true) with check (true);

create policy "accesso aperto cancellazione"
  on public.app_storage for delete
  using (true);

-- ===========================================================================
-- FATTO. La tua app e' pronta a salvare i dati.
-- ===========================================================================


-- ===========================================================================
-- (FACOLTATIVO) VERSIONE PROTETTA — leggi solo se vuoi piu' sicurezza
--
-- Se un domani vuoi che solo persone loggate possano leggere/scrivere,
-- attiva l'autenticazione in Supabase (Authentication -> Providers),
-- poi sostituisci le 4 policy qui sopra con queste (che richiedono un utente
-- autenticato). Dovrai pero' aggiungere una schermata di login nell'app.
--
--   create policy "solo loggati"
--     on public.app_storage for all
--     using (auth.role() = 'authenticated')
--     with check (auth.role() = 'authenticated');
--
-- Per la squadra di volontari NON e' necessario: la versione aperta va bene.
-- ===========================================================================
