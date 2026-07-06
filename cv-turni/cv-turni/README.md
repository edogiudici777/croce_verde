# Turni Squadra — Croceverde APM Milano

App per gestire i turni della squadra: i compagni inseriscono le disponibilità,
il caposquadra compone gli equipaggi, gestisce cambusa, rimpiazzi, permessi,
diurne weekend, classifiche e pubblica il foglio del turno (anche in PDF).

Questa guida ti porta da "ho i file" a "ho un link da mandare ai compagni".
Tutto gratis. Servono ~15-20 minuti. Non serve saper programmare: segui i passi.

---

## Cosa ti serve

- Un computer con **Node.js** installato (scaricalo da https://nodejs.org — versione "LTS").
- Un account **GitHub** (gratis): https://github.com
- Un account **Supabase** (gratis): https://supabase.com  → è il database
- Un account **Vercel** (gratis): https://vercel.com  → mette l'app online

---

## Passo 1 — Prova l'app sul tuo computer (facoltativo ma consigliato)

1. Apri il Terminale (su Windows: "Prompt dei comandi" o "PowerShell").
2. Spostati nella cartella del progetto, per esempio:
   ```
   cd percorso/della/cartella/cv-turni
   ```
3. Installa le dipendenze (una volta sola):
   ```
   npm install
   ```
4. Per ora salta l'avvio: prima creiamo il database (Passo 2). Torneremo qui.

---

## Passo 2 — Crea il database su Supabase

1. Vai su https://supabase.com e accedi.
2. Premi **New project**. Dai un nome (es. "turni-squadra"), scegli una password
   per il database (salvala da qualche parte) e una regione vicina (es. Frankfurt).
   Aspetta 1-2 minuti che il progetto sia pronto.
3. Nel menu a sinistra apri **SQL Editor** → **New query**.
4. Apri il file `supabase_schema.sql` (è nella cartella del progetto), copia
   TUTTO il contenuto, incollalo nell'editor e premi **Run** (in basso a destra).
   Deve dire "Success". Hai creato la tabella dei dati. ✅

---

## Passo 3 — Collega l'app al database

1. Sempre su Supabase, menu a sinistra: **Project Settings** (l'ingranaggio) →
   **API**.
2. Copia due valori:
   - **Project URL** (qualcosa come `https://xxxx.supabase.co`)
   - **anon public** key (sotto "Project API keys" — è una stringa lunga;
     usa quella chiamata `anon` / `public`, NON la `service_role`)
3. Nella cartella del progetto, copia il file `.env.example` e rinomina la copia
   in `.env` (proprio così, con il punto davanti e senza estensione).
4. Apri `.env` con un editor di testo e incolla i due valori:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=la-stringa-lunga-anon
   ```
   Niente virgolette, niente spazi attorno all'uguale.

Ora puoi provarla in locale:
```
npm run dev
```
Apri l'indirizzo che compare (di solito http://localhost:5173). Inserisci
qualche disponibilità: se ricaricando la pagina i dati restano, il database
funziona. 🎉

---

## Passo 4 — Cambia il PIN del caposquadra (IMPORTANTE)

Il PIN di default è `1854`. Cambialo prima di condividere l'app.

1. Apri `src/TurniSquadra.jsx`.
2. Cerca questa riga (usa la ricerca del tuo editor):
   ```
   if (pin === "1854") {
   ```
3. Sostituisci `1854` con il tuo PIN (es. `"7391"`). Salva.
4. Più in basso c'è anche il testo "PIN demo: 1854 (l'anno di fondazione)":
   puoi cancellare quella riga così non si vede più il suggerimento.

---

## Passo 5 — Metti l'app online con Vercel

Modo più semplice (tramite GitHub):

1. Crea un repository su GitHub e carica dentro la cartella del progetto.
   (Se non sai usare git: su github.com fai "New repository", poi
   "uploading an existing file" e trascina i file — NON caricare la cartella
   `node_modules` né il file `.env`; il `.gitignore` già li esclude se usi git.)
2. Vai su https://vercel.com → **Add New** → **Project** → importa il repository.
3. Vercel riconosce Vite da solo. Prima di premere Deploy, apri
   **Environment Variables** e aggiungi le DUE chiavi del Passo 3:
   - `VITE_SUPABASE_URL` = il tuo Project URL
   - `VITE_SUPABASE_ANON_KEY` = la tua anon key
4. Premi **Deploy**. Dopo un minuto avrai un link tipo
   `https://turni-squadra.vercel.app`.

**Quel link è quello da mandare ai compagni.** 🚑

---

## Domande pratiche

**I compagni devono installare qualcosa?**
No. Aprono il link dal telefono, scelgono il nome e mettono le disponibilità.

**I dati sono condivisi davvero?**
Sì: tutto passa dal database Supabase, quindi quello che mette un compagno lo
vedi tu e viceversa, da qualsiasi dispositivo.

**Le notifiche ("devi cercare rimpiazzo", foglio pubblicato) arrivano via SMS?**
No, sono in-app: compaiono quando la persona apre il link. Per notifiche vere
(WhatsApp/email push) serve un pezzo aggiuntivo lato server — si può aggiungere
in seguito.

**Il PDF come si scarica?**
Dal pulsante "Scarica PDF" nel foglio del turno: si apre la stampa del browser,
poi "Salva come PDF". Funziona anche da telefono.

**Quanto costa?**
Niente, con i piani gratuiti di Supabase e Vercel sei ampiamente dentro i limiti
per una squadra.

---

## Struttura dei file

```
cv-turni/
├── index.html              punto d'ingresso
├── package.json            dipendenze
├── vite.config.js          configurazione build
├── vercel.json             configurazione per Vercel
├── supabase_schema.sql     da incollare in Supabase (Passo 2)
├── .env.example            modello per le chiavi (Passo 3)
└── src/
    ├── main.jsx            avvia l'app
    ├── storage.js          collega il salvataggio a Supabase
    └── TurniSquadra.jsx    l'app vera e propria (tutto il resto)
```

Il file `src/storage.js` è l'unico "ponte" verso il database: se un domani
vuoi cambiare database, basta riscrivere quel file lasciando tutto il resto
intatto.
