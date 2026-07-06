# App sul telefono + Notifiche — Guida PWA

Questa guida completa la `README.md`. Riguarda due cose nuove:
1. **Installare l'app sulla schermata Home** (icona come un'app vera)
2. **Attivare le notifiche** (avviso rimpiazzo, foglio pubblicato)

La parte 1 funziona subito, senza fare nulla in più.
La parte 2 (notifiche push vere, con app chiusa) richiede un piccolo setup:
segui la sezione "Notifiche push" più sotto.

---

## 1. Installare l'app sulla schermata Home

Una volta che l'app è online (link Vercel), ogni compagno può "installarla":

**Su Android (Chrome):**
Apri il link → menu (tre puntini) → "Aggiungi a schermata Home" / "Installa app".
Comparirà l'icona con la croce verde. Si apre a schermo intero, come un'app.

**Su iPhone (Safari — importante: deve essere Safari):**
Apri il link → pulsante Condividi (il quadrato con la freccia) →
"Aggiungi a Home". Poi apri l'app DALL'ICONA, non da Safari.

Non serve nessuno store, nessun download, nessun costo.

---

## 2. Notifiche

Nell'app, nella schermata delle disponibilità, dopo aver scelto il proprio nome,
compare il pulsante **"🔔 Attiva le notifiche"**. Ogni compagno lo preme una volta.

Da quel momento riceve una notifica quando:
- il caposquadra attiva l'avviso **"devi cercare rimpiazzo!"**
- il caposquadra **pubblica** il foglio degli equipaggi

**iPhone:** le notifiche funzionano SOLO se l'app è stata prima "aggiunta alla
schermata Home" (vedi sopra) e viene aperta dall'icona. È una regola di Apple.

---

## Notifiche push — setup (da fare una volta sola)

Perché le notifiche arrivino anche con l'app chiusa serve un piccolo "postino"
lato server. Usiamo una funzione di Supabase. Ecco i passi.

### A) Genera le chiavi VAPID

Le chiavi VAPID sono l'identità del tuo "postino". Generale così (sul tuo PC,
serve Node.js):

```
npx web-push generate-vapid-keys
```

Ti stampa due stringhe: **Public Key** e **Private Key**. Tienile da parte.

(In alternativa online: cerca "vapid key generator". Ma da terminale è più sicuro.)

### B) Metti la chiave PUBBLICA nell'app

- In locale: nel file `.env`, riga `VITE_VAPID_PUBLIC_KEY=` incolla la Public Key.
- Su Vercel: Project → Settings → Environment Variables → aggiungi
  `VITE_VAPID_PUBLIC_KEY` con lo stesso valore. Poi fai un nuovo Deploy.

### C) Pubblica la funzione "postino" su Supabase

La funzione è già scritta: `supabase/functions/send-push/index.ts`.
Per pubblicarla serve la CLI di Supabase (una volta sola):

```
npm install -g supabase
supabase login
supabase link --project-ref IL-TUO-PROJECT-REF
supabase functions deploy send-push --no-verify-jwt
```

(`IL-TUO-PROJECT-REF` è la parte prima di `.supabase.co` nel tuo URL.)

### D) Dai le chiavi alla funzione

La funzione ha bisogno di sapere le chiavi. Impostale così:

```
supabase secrets set VAPID_PUBLIC_KEY=la-tua-public-key
supabase secrets set VAPID_PRIVATE_KEY=la-tua-private-key
supabase secrets set VAPID_SUBJECT=mailto:tua-email@esempio.it
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` sono già disponibili
automaticamente dentro le funzioni Supabase, non devi impostarle tu.

### Fatto

Ora quando il caposquadra attiva un avviso o pubblica un foglio, l'app chiama
la funzione, che invia la notifica a tutti gli iscritti. 🎉

---

## Se le notifiche non partono — controlli rapidi

- Il compagno ha premuto "Attiva le notifiche" e dato il permesso?
- Su iPhone: l'app è aperta dall'icona in Home (non da Safari)?
- La `VITE_VAPID_PUBLIC_KEY` è impostata su Vercel **e** hai rifatto il Deploy?
- I `secrets` della funzione sono impostati (punto D)?
- La funzione è pubblicata (punto C)? Puoi vederla su Supabase → Edge Functions.

Le notifiche sono un "extra": se qualcosa non è configurato, l'app continua a
funzionare normalmente e gli avvisi restano comunque visibili aprendo l'app.

---

## Nota su privacy (importante se scalerai ad altre squadre)

L'app raccoglie nomi, disponibilità e motivi di assenza — tra cui "salute",
che è un dato sensibile. Per una singola squadra di volontari, con accesso via
link e PIN, l'impatto è contenuto. Se un domani la aprirai a più squadre con
login personali, sarà bene formalizzare privacy e consensi (GDPR) e valutare un
coinvolgimento di Croceverde a livello associativo.
