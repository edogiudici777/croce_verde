import React, { useState, useEffect, useMemo, useCallback } from "react";
import seedStorico from "./seed_storico.json";

/* Apre WhatsApp con un messaggio già pronto da inviare al gruppo squadra.
   Non serve alcun server: usa il link ufficiale wa.me / whatsapp://.
   L'utente preme solo "invia" nel gruppo. */
function shareWhatsApp(text) {
  const encoded = encodeURIComponent(text);
  // wa.me funziona su telefono (apre l'app) e su desktop (WhatsApp Web)
  window.open(`https://wa.me/?text=${encoded}`, "_blank");
}

/* =========================================================================
   CROCEVERDE APM — Gestione Turni Squadra
   Singolo file. Salvataggio persistente via window.storage (shared).
   Due aree:
     - COMPAGNI: inserimento disponibilità (semplicissimo)
     - CAPOSQUADRA: dashboard, assegnazione equipaggi, cambusa, classifiche
   ========================================================================= */

/* ---------- Config dominio ---------- */
const CICLO_START = "2026-06-24";   // primo turno notturno
const CICLO_GIORNI = 10;            // un turno ogni 10 giorni
const GIORNI_AVANTI = 90;           // genera i turni fino a ~3 mesi nel futuro
const EQUIPAGGI_PER_META = 2;       // 2 equipaggi prima, 2 dopo mezzanotte
const GIORNI_SETT = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

/* disponibilità per metà turno */
const DISPO = {
  ASSENTE: { id: "ASSENTE", label: "Assente", short: "—", color: "var(--c-absent)" },
  PRIMA: { id: "PRIMA", label: "Solo prima di mezzanotte", short: "Prima", color: "var(--c-pre)" },
  DOPO: { id: "DOPO", label: "Solo dopo mezzanotte", short: "Dopo", color: "var(--c-post)" },
  ENTRAMBE: { id: "ENTRAMBE", label: "Tutto il turno", short: "Tutto", color: "var(--c-both)" },
};

/* ruoli */
const RUOLI = {
  autista: "Autista",
  capo: "Capoequipaggio",
  soccorritore: "Soccorritore",
};

/* motivi assenza (il commento resta privato, il motivo è pubblico nel PDF) */
const MOTIVI = {
  lavoro: { label: "Lavoro", icon: "💼" },
  studio: { label: "Studio", icon: "📚" },
  sanitaria: { label: "Salute", icon: "🩺" },
  altro: { label: "Altro", icon: "•" },
};
const MOTIVI_ORDER = ["lavoro", "studio", "sanitaria", "altro"];

/* ---------- metà turno: notte = prima/dopo mezzanotte, diurna = mattina/pomeriggio ---------- */
const HALF_KEYS = ["pre", "post"];
function isDiurnaTurno(turno) {
  return (turno?.kind === "diurna") || (typeof turno === "string" && turno.endsWith(":diurna"));
}
function halfLabel(turno, key) {
  if (isDiurnaTurno(turno)) return key === "pre" ? "Mattina" : "Pomeriggio";
  return key === "pre" ? "Prima di mezzanotte" : "Dopo mezzanotte";
}
function halfIcon(turno, key) {
  if (isDiurnaTurno(turno)) return key === "pre" ? "🌅" : "🌤️";
  return key === "pre" ? "🌙" : "🌃";
}

/* ---------- util date ---------- */
function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function fmt(date) {
  return `${GIORNI_SETT[date.getDay()]} ${date.getDate()} ${MESI[date.getMonth()]}`;
}
// un turno è "passato" se la sua data è prima di oggi (mezzanotte di oggi)
function isPast(turno) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return turno.date < today;
}
// ricostruisce un oggetto turno da un id ("2026-05-05" o "2026-05-30:diurna")
function turnoFromId(id) {
  const isDiurna = id.endsWith(":diurna");
  const dateStr = isDiurna ? id.slice(0, -":diurna".length) : id;
  const d = parseISO(dateStr);
  return {
    id,
    kind: isDiurna ? "diurna" : "notte",
    date: d,
    label: fmt(d),
  };
}

// un turno resta "attivo" (visibile in home, modificabile dal capo) fino alla FINE del giorno dopo il turno.
// Va in archivio solo dal secondo giorno successivo.
function stillActive(turno) {
  const limit = addDays(turno.date, 2); // inizio di due giorni dopo
  limit.setHours(0, 0, 0, 0);
  return new Date() < limit;
}
function genTurni(startISO, n) {
  const start = parseISO(startISO);
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(start, i * CICLO_GIORNI);
    const iso = toISO(d);
    const wd = d.getDay(); // 1 = lun, 2 = mar
    // regola diurna weekend: lun→sab, mar→dom (5 giorni dopo). Solo lun/mar.
    const hasDiurna = wd === 1 || wd === 2;
    const diurnaISO = hasDiurna ? toISO(addDays(d, 5)) : null;

    out.push({
      id: iso,
      kind: "notte",
      date: d,
      label: fmt(d),
      diurnaWE: diurnaISO,
      diurnaLabel: diurnaISO ? fmt(parseISO(diurnaISO)) : null,
    });

    if (hasDiurna) {
      const dd = parseISO(diurnaISO);
      out.push({
        id: diurnaISO + ":diurna",
        kind: "diurna",
        date: dd,
        label: fmt(dd),
        parentId: iso,
        parentLabel: fmt(d),
      });
    }
  }
  // ordina per data così notte e diurna si susseguono cronologicamente
  out.sort((a, b) => a.date - b.date || (a.kind === "notte" ? -1 : 1));
  return out;
}

/* ---------- storage helpers ---------- */
const KEY_PEOPLE = "cv:people";
const KEY_AVAIL = "cv:availability";      // { [turnoId]: { [personId]: {pre, post} } }
const KEY_ASSIGN = "cv:assignments";      // { [turnoId]: { pre:[crew], post:[crew] } }
const KEY_GALLEY = "cv:galley";           // { [turnoId]: [personId, personId] }
const KEY_CONFIG = "cv:config";           // { [turnoId]: { pre:nCrews, post:nCrews } }
const KEY_ALERTS = "cv:alerts";           // { [turnoId]: { active:bool, resolved:{ [personId]: {sub, role, squad} } } }
const KEY_PUBLISHED = "cv:published";     // { [turnoId]: { at:iso, message:string } }
const KEY_REPORTS = "cv:reports";         // { [YYYY-MM]: { nturni, persone:{ [cognome]: {...counts} } } } — override/storico
const KEY_IMPORTED = "cv:imported";       // { done: bool } — flag storico già importato

async function sget(key, fallback) {
  try {
    const r = await window.storage.get(key, true);
    return r ? JSON.parse(r.value) : fallback;
  } catch {
    return fallback;
  }
}
async function sset(key, value) {
  try {
    await window.storage.set(key, JSON.stringify(value), true);
    return true;
  } catch {
    return false;
  }
}

/* ===========================================================================
   ROOT
   =========================================================================== */
export default function App() {
  const [tab, setTab] = useState("compagni"); // compagni | capo
  const [unlocked, setUnlocked] = useState(false);

  // dati condivisi
  const [people, setPeople] = useState(null);
  const [availability, setAvailability] = useState({});
  const [assignments, setAssignments] = useState({});
  const [galley, setGalley] = useState({});
  const [config, setConfig] = useState({});
  const [alerts, setAlerts] = useState({});
  const [published, setPublished] = useState({});
  const [reports, setReports] = useState({});
  const [imported, setImported] = useState({});
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error

  const turni = useMemo(() => {
    const start = parseISO(CICLO_START);
    const end = addDays(new Date(), GIORNI_AVANTI);
    // quanti cicli da CICLO_START fino a end (almeno 6, per sicurezza)
    const giorni = Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
    const n = Math.max(6, Math.ceil(giorni / CICLO_GIORNI) + 1);
    return genTurni(CICLO_START, n);
  }, []);

  // load
  useEffect(() => {
    (async () => {
      const p = await sget(KEY_PEOPLE, SEED_PEOPLE);
      const a = await sget(KEY_AVAIL, {});
      const as = await sget(KEY_ASSIGN, {});
      const g = await sget(KEY_GALLEY, {});
      const cfg = await sget(KEY_CONFIG, {});
      const al = await sget(KEY_ALERTS, {});
      const pub = await sget(KEY_PUBLISHED, {});
      const rep = await sget(KEY_REPORTS, {});
      const imp = await sget(KEY_IMPORTED, {});
      setPeople(p);
      setAvailability(a);
      setAssignments(as);
      setGalley(g);
      setConfig(cfg);
      setAlerts(al);
      setPublished(pub);
      setReports(rep);
      setImported(imp);
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(async (key, value) => {
    setSaveState("saving");
    const ok = await sset(key, value);
    setSaveState(ok ? "saved" : "error");
    if (ok) setTimeout(() => setSaveState("idle"), 1500);
  }, []);

  const savePeople = (next) => { setPeople(next); persist(KEY_PEOPLE, next); };
  const saveAvail = (next) => { setAvailability(next); persist(KEY_AVAIL, next); };
  const saveAssign = (next) => { setAssignments(next); persist(KEY_ASSIGN, next); };
  const saveGalley = (next) => { setGalley(next); persist(KEY_GALLEY, next); };
  const saveConfig = (next) => { setConfig(next); persist(KEY_CONFIG, next); };
  const saveAlerts = (next) => { setAlerts(next); persist(KEY_ALERTS, next); };
  const savePublished = (next) => { setPublished(next); persist(KEY_PUBLISHED, next); };
  const saveReports = (next) => { setReports(next); persist(KEY_REPORTS, next); };
  const saveImported = (next) => { setImported(next); persist(KEY_IMPORTED, next); };

  // numero equipaggi per metà di un turno (default EQUIPAGGI_PER_META).
  // Una diurna è un turno unico: di default 1 equipaggio sulla metà "pre", 0 sulla "post".
  const crewsFor = (turnoId, half) => {
    const explicit = config[turnoId]?.[half];
    if (explicit !== undefined) return explicit;
    const isDiurna = turnoId.endsWith(":diurna");
    if (isDiurna) return 1;
    return EQUIPAGGI_PER_META;
  };

  if (loading) {
    return (
      <div style={S.shell}>
        <Style />
        <div style={{ padding: 80, textAlign: "center", color: "var(--ink-soft)" }}>Carico i dati della squadra…</div>
      </div>
    );
  }

  return (
    <div style={S.shell}>
      <Style />
      <Header tab={tab} setTab={setTab} unlocked={unlocked} saveState={saveState} />
      <div key={tab} className="page-anim">
      {tab === "compagni" && (
        <CompagniView
          turni={turni}
          people={people}
          availability={availability}
          saveAvail={saveAvail}
          alerts={alerts}
          saveAlerts={saveAlerts}
          published={published}
          assignments={assignments}
          crewsFor={crewsFor}
        />
      )}
      {tab === "capo" && (
        <CapoGate unlocked={unlocked} setUnlocked={setUnlocked}>
          <CapoView
            turni={turni}
            people={people}
            savePeople={savePeople}
            availability={availability}
            assignments={assignments}
            saveAssign={saveAssign}
            galley={galley}
            saveGalley={saveGalley}
            config={config}
            saveConfig={saveConfig}
            crewsFor={crewsFor}
            alerts={alerts}
            saveAlerts={saveAlerts}
            published={published}
            savePublished={savePublished}
            reports={reports}
            saveReports={saveReports}
            imported={imported}
            saveImported={saveImported}
          />
        </CapoGate>
      )}
      </div>
      <footer style={S.footer}>
        Croceverde APM Milano · turni ogni {CICLO_GIORNI} giorni · i dati sono condivisi tra tutti
      </footer>
    </div>
  );
}

/* ===========================================================================
   HEADER
   =========================================================================== */
function Header({ tab, setTab, unlocked, saveState }) {
  return (
    <header style={S.header}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={S.cross}>+</div>
        <div>
          <div style={S.brand}>Turni Squadra</div>
          <div style={S.brandSub}>Croceverde APM · Milano</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <SaveDot state={saveState} />
        <div style={S.tabs}>
          <button
            className="tap tabline"
            style={{ ...S.tab, ...(tab === "compagni" ? S.tabOn : {}) }}
            onClick={() => setTab("compagni")}
          >
            Le mie disponibilità
          </button>
          <button
            className="tap tabline"
            style={{ ...S.tab, ...(tab === "capo" ? S.tabOn : {}) }}
            onClick={() => setTab("capo")}
          >
            Caposquadra {unlocked ? "" : "🔒"}
          </button>
        </div>
      </div>
    </header>
  );
}

function SaveDot({ state }) {
  if (state === "idle") return null;
  const map = {
    saving: ["var(--c-post)", "Salvo…"],
    saved: ["var(--c-both)", "Salvato"],
    error: ["var(--c-absent)", "Errore salvataggio"],
  };
  const [color, txt] = map[state];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-soft)" }}>
      <span style={{ width: 8, height: 8, borderRadius: 8, background: color }} />
      {txt}
    </span>
  );
}

/* ===========================================================================
   COMPAGNI — inserimento disponibilità (semplice, grande, leggibile)
   =========================================================================== */
function NotificationButton() {
  return (
    <div style={{ ...S.notifBar, marginLeft: 4 }}>
      💬 Gli avvisi (turni scoperti, equipaggi pubblicati) arrivano sul gruppo
      WhatsApp della squadra. Tieni d'occhio il gruppo!
    </div>
  );
}

function CompagniView({ turni, people, availability, saveAvail, alerts, saveAlerts, published, assignments, crewsFor }) {
  const [personId, setPersonId] = useState("");

  const me = people.find((p) => p.id === personId);
  const pById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const futureTurni = useMemo(() => turni.filter((t) => !isPast(t)), [turni]);
  const publishedTurni = useMemo(() => turni.filter((t) => published[t.id] && stillActive(t)), [turni, published]);

  // turni futuri in cui HO dato indisponibilità: qui posso SEMPRE segnalare un rimpiazzo,
  // di mia iniziativa, senza aspettare il via del caposquadra.
  const myAbsentTurni = useMemo(() => {
    if (!personId) return [];
    if (me?.permesso) return []; // chi è in permesso non deve cercare rimpiazzi
    return turni.filter((t) => {
      if (isPast(t)) return false;
      const a = availability[t.id]?.[personId];
      const isAbsent = !a || (a.pre === "ASSENTE" && a.post === "ASSENTE");
      return isAbsent;
    });
  }, [personId, turni, availability, me]);

  // sottoinsieme urgente: turni dove il caposquadra ha attivato il sollecito "cerca rimpiazzo"
  const myUrgentTurni = useMemo(
    () => myAbsentTurni.filter((t) => alerts[t.id]?.active),
    [myAbsentTurni, alerts]
  );

  const saveMySub = (turnoId, field, value) => {
    const next = JSON.parse(JSON.stringify(alerts));
    if (!next[turnoId]) next[turnoId] = { active: false, resolved: {} }; // segnalare NON attiva il sollecito del capo
    if (!next[turnoId].resolved) next[turnoId].resolved = {};
    const cur = next[turnoId].resolved[personId] || { sub: "", role: "soccorritore", squad: "" };
    cur[field] = value;
    next[turnoId].resolved[personId] = cur;
    saveAlerts(next);
  };

  // riga con i campi per segnalare un rimpiazzo su un turno
  const renderSubRow = (t) => {
    const r = alerts[t.id]?.resolved?.[personId] || { sub: "", role: "soccorritore", squad: "" };
    const done = r.sub && r.sub.trim();
    return (
      <div key={t.id} style={S.alertTurno}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <b style={{ textTransform: "capitalize" }}>{t.label}</b>
          {done && <span style={S.doneTag}>✓ rimpiazzo trovato</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={{ ...S.slotSelect, flex: 1, minWidth: 140, maxWidth: "none" }}
            placeholder="Nome del sostituto" value={r.sub}
            onChange={(e) => saveMySub(t.id, "sub", e.target.value)} />
          <input style={{ ...S.slotSelect, width: 130, maxWidth: "none" }}
            placeholder="Sua squadra" value={r.squad}
            onChange={(e) => saveMySub(t.id, "squad", e.target.value)} />
          <select style={{ ...S.slotSelect, maxWidth: "none" }} value={r.role}
            onChange={(e) => saveMySub(t.id, "role", e.target.value)}>
            <option value="soccorritore">Soccorritore</option>
            <option value="autista">Autista</option>
            <option value="capo">Capoequipaggio</option>
          </select>
        </div>
      </div>
    );
  };

  const setDispo = (turnoId, half, value, diurna = false) => {
    const next = JSON.parse(JSON.stringify(availability));
    if (!next[turnoId]) next[turnoId] = {};
    if (!next[turnoId][personId]) next[turnoId][personId] = { pre: "ASSENTE", post: "ASSENTE" };
    if (diurna) {
      next[turnoId][personId].pre = value;
      next[turnoId][personId].post = value;
    } else {
      next[turnoId][personId][half] = value;
    }
    saveAvail(next);
  };

  // scorciatoia: imposta entrambe le metà in un colpo
  const setQuick = (turnoId, mode) => {
    const map = {
      ASSENTE: { pre: "ASSENTE", post: "ASSENTE" },
      PRIMA: { pre: "ENTRAMBE", post: "ASSENTE" },
      DOPO: { pre: "ASSENTE", post: "ENTRAMBE" },
      TUTTO: { pre: "ENTRAMBE", post: "ENTRAMBE" },
    }[mode];
    const next = JSON.parse(JSON.stringify(availability));
    if (!next[turnoId]) next[turnoId] = {};
    const prev = next[turnoId][personId] || {};
    next[turnoId][personId] = { ...map, reason: prev.reason || "", note: prev.note || "" };
    saveAvail(next);
  };

  const setReasonField = (turnoId, field, value) => {
    const next = JSON.parse(JSON.stringify(availability));
    if (!next[turnoId]) next[turnoId] = {};
    if (!next[turnoId][personId]) next[turnoId][personId] = { pre: "ASSENTE", post: "ASSENTE" };
    next[turnoId][personId][field] = value;
    saveAvail(next);
  };

  return (
    <main style={S.main}>
      {publishedTurni.length > 0 && (
        <div style={{ marginBottom: 26 }}>
          <div style={S.eyebrow}>📋 Equipaggi pubblicati</div>
          <h2 style={{ ...S.h2, marginBottom: 12 }}>Turni confermati dal caposquadra</h2>
          {publishedTurni.map((t) => (
            <div key={t.id} style={{ marginBottom: 14 }}>
              <SheetView
                turno={t}
                sheet={buildSheet(t, people, assignments, availability, crewsFor, pById)}
                message={published[t.id]?.message}
              />
            </div>
          ))}
        </div>
      )}

      <div style={S.bigCard}>
        <div style={S.eyebrow}>Passo 1</div>
        <h2 style={S.h2}>Chi sei?</h2>
        <select
          style={S.bigSelect}
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
        >
          <option value="">— Scegli il tuo nome —</option>
          {[...people].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {!personId && (
          <p style={S.helper}>Seleziona il tuo nome per inserire le disponibilità. Non trovi il tuo nome? Scrivi al caposquadra.</p>
        )}
      </div>

      {me && (
        <>
          {(() => {
            // solo il sollecito URGENTE resta in cima (è un avviso)
            if (myUrgentTurni.length === 0) return null;
            return (
              <div style={S.alertBanner}>
                <div style={{ fontSize: 22 }}>🔴</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Devi cercare un rimpiazzo!</div>
                  <p style={{ ...S.helper, color: "#ffd9d4", margin: "0 0 12px" }}>
                    Per {myUrgentTurni.length === 1 ? "questo turno siamo scoperti" : "questi turni siamo scoperti"} e tu hai dato indisponibilità. Trova qualcuno che ti sostituisca e segna qui chi hai trovato.
                  </p>
                  {myUrgentTurni.map((t) => renderSubRow(t))}
                </div>
              </div>
            );
          })()}

          <div style={{ ...S.eyebrow, marginTop: 28, marginLeft: 4 }}>Passo 2 · Ciao {(me.cognome && me.name.startsWith(me.cognome) ? me.name.slice(me.cognome.length).trim().split(" ")[0] : me.name.split(" ")[0]) || me.name}!</div>
          <NotificationButton personId={personId} />
          {me.permesso && (
            <div style={{ ...S.bigCard, marginTop: 8, borderColor: "var(--c-post)" }}>
              <h2 style={{ ...S.h2, marginBottom: 6 }}>Sei in permesso 🌴</h2>
              <p style={S.helper}>
                Non sei obbligato a dare disponibilità e non ti verrà chiesto di cercare un rimpiazzo. Ma se in qualche turno puoi scendere, segnalo pure qui sotto: se servi, il caposquadra può metterti in equipaggio.
              </p>
            </div>
          )}
          <>
          <h2 style={{ ...S.h2, marginLeft: 4, marginBottom: 4 }}>{me.permesso ? "Se puoi, segna i turni" : "Segna i turni del mese"}</h2>
          <p style={{ ...S.helper, marginLeft: 4, marginTop: 0, marginBottom: 18 }}>
            Per ogni notte dicci se puoi <b>prima di mezzanotte</b>, <b>dopo</b>, tutto, o se sei assente. I bottoni veloci impostano tutto in un tocco.
          </p>

          <div style={S.turniGrid} className="stagger">
            {futureTurni
              .filter((t) => !(me?.hide?.weekend && t.kind === "diurna"))
              .map((t) => {
              const cur = availability[t.id]?.[personId] || { pre: "ASSENTE", post: "ASSENTE" };
              const isDiurna = t.kind === "diurna";
              const hidePre = !!me?.hide?.pre;
              const hidePost = !!me?.hide?.post;
              const bothHalves = !hidePre && !hidePost;
              const quickActive =
                cur.pre === "ENTRAMBE" && cur.post === "ENTRAMBE" ? "TUTTO" :
                cur.pre === "ENTRAMBE" && cur.post === "ASSENTE" ? "PRIMA" :
                cur.pre === "ASSENTE" && cur.post === "ENTRAMBE" ? "DOPO" :
                cur.pre === "ASSENTE" && cur.post === "ASSENTE" ? "ASSENTE" : null;
              return (
                <div key={t.id} className="card-h" style={{ ...S.turnoCard, ...(isDiurna ? S.turnoCardDiurna : {}) }}>
                  <div style={S.turnoHead}>
                    <div>
                      <div style={S.turnoDate}>{isDiurna ? "☀️ " : ""}{t.label}</div>
                      <div style={S.turnoYear}>
                        {isDiurna ? `diurna weekend · da ${t.parentLabel} notte` : `turno notturno · ${t.date.getFullYear()}`}
                      </div>
                    </div>
                  </div>

                  {bothHalves && (
                  <div style={S.quickRow}>
                    {[
                      ["TUTTO", "Tutto il turno"],
                      ["PRIMA", isDiurna ? "Solo mattina" : "Solo prima"],
                      ["DOPO", isDiurna ? "Solo pomeriggio" : "Solo dopo"],
                      ["ASSENTE", "Assente"],
                    ].map(([mode, lbl]) => (
                      <button
                        key={mode}
                        onClick={() => setQuick(t.id, mode)}
                        className="tap" style={{ ...S.quickBtn, ...(quickActive === mode ? S.quickBtnOn : {}) }}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                  )}

                  <div style={S.halfRow}>
                    {!hidePre && <HalfPicker label={halfLabel(t, "pre")} value={cur.pre} onChange={(v) => setDispo(t.id, "pre", v)} />}
                    {!hidePost && <HalfPicker label={halfLabel(t, "post")} value={cur.post} onChange={(v) => setDispo(t.id, "post", v)} />}
                  </div>

                  {cur.pre === "ASSENTE" && cur.post === "ASSENTE" && (
                    <div style={S.reasonBox}>
                      <div style={S.halfLabel}>Perché sei assente?</div>
                      <div style={S.reasonRow}>
                        {MOTIVI_ORDER.map((mk) => (
                          <button
                            key={mk}
                            onClick={() => setReasonField(t.id, "reason", mk)}
                            style={{ ...S.reasonBtn, ...(cur.reason === mk ? S.reasonBtnOn : {}) }}
                          >
                            {MOTIVI[mk].icon} {MOTIVI[mk].label}
                          </button>
                        ))}
                      </div>
                      <input
                        style={{ ...S.slotSelect, width: "100%", maxWidth: "none", marginTop: 8 }}
                        placeholder="Commento (facoltativo, lo vede solo il caposquadra)"
                        value={cur.note || ""}
                        onChange={(e) => setReasonField(t.id, "note", e.target.value)}
                      />
                    </div>
                  )}

                  {t.diurnaWE && (
                    <div style={S.weNote}>
                      ↳ con questo turno c'è anche la diurna di <b>{t.diurnaLabel}</b> (la trovi qui sotto in elenco)
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p style={{ ...S.helper, textAlign: "center", marginTop: 22 }}>
            Le tue scelte si salvano da sole. Puoi tornare quando vuoi a modificarle.
          </p>

          {(() => {
            const nonUrgent = myAbsentTurni.filter((t) => !alerts[t.id]?.active);
            if (nonUrgent.length === 0) return null;
            return (
              <div style={S.subOfferBox}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>🔁 Hai trovato un rimpiazzo?</div>
                <p style={{ ...S.helper, margin: "0 0 12px" }}>
                  Sei assente in {nonUrgent.length === 1 ? "questo turno" : "questi turni"}. Se hai già trovato qualcuno che ti sostituisce, segnalo qui: il caposquadra lo vedrà e potrà inserirlo. (Non sei obbligato: è per darti una mano.)
                </p>
                {nonUrgent.map((t) => renderSubRow(t))}
              </div>
            );
          })()}
          </>
        </>
      )}
    </main>
  );
}

function HalfPicker({ label, value, onChange }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={S.halfLabel}>{label}</div>
      <div style={S.segGroup}>
        {["ASSENTE", "ENTRAMBE"].map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              ...S.segBtn,
              ...(value === opt ? { ...S.segBtnOn, background: opt === "ENTRAMBE" ? "var(--c-both)" : "var(--c-absent)" } : {}),
            }}
          >
            {opt === "ENTRAMBE" ? "Disponibile" : "No"}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ===========================================================================
   GATE caposquadra
   =========================================================================== */
function CapoGate({ unlocked, setUnlocked, children }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  if (unlocked) return children;
  const tryUnlock = () => {
    if (pin === "1854") { setUnlocked(true); setErr(false); }
    else setErr(true);
  };
  return (
    <main style={S.main}>
      <div style={{ ...S.bigCard, maxWidth: 420, margin: "40px auto", textAlign: "center" }}>
        <div style={S.cross}>+</div>
        <h2 style={{ ...S.h2, marginTop: 16 }}>Area caposquadra</h2>
        <p style={S.helper}>Questa parte è riservata. Inserisci il PIN.</p>
        <input
          style={{ ...S.bigSelect, textAlign: "center", letterSpacing: 8, fontSize: 24 }}
          value={pin}
          type="password"
          inputMode="numeric"
          placeholder="••••"
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
        />
        {err && <p style={{ color: "var(--c-absent)", fontSize: 14, marginTop: 8 }}>PIN errato, riprova.</p>}
        <button style={{ ...S.primaryBtn, marginTop: 14, width: "100%" }} onClick={tryUnlock}>Entra</button>
        <p style={{ ...S.helper, marginTop: 14, fontSize: 12 }}>PIN demo: 1854 (l'anno di fondazione). Cambialo nel codice.</p>
      </div>
    </main>
  );
}

/* ===========================================================================
   CAPOSQUADRA — dashboard
   =========================================================================== */
function CapoView(props) {
  const [section, setSection] = useState("turni"); // turni | persone | classifiche | archivio
  return (
    <main style={S.main}>
      <div style={S.subnav}>
        {[
          ["turni", "Turni & equipaggi"],
          ["persone", "Squadra"],
          ["classifiche", "Classifiche"],
          ["report", "Report"],
          ["archivio", "Archivio"],
        ].map(([k, l]) => (
          <button key={k} className="tap tabline" style={{ ...S.subnavBtn, ...(section === k ? S.subnavOn : {}) }} onClick={() => setSection(k)}>
            {l}
          </button>
        ))}
      </div>
      <div key={section} className="page-anim">
      {section === "turni" && <TurniCapo {...props} />}
      {section === "persone" && <PersoneCapo {...props} />}
      {section === "classifiche" && <Classifiche {...props} />}
      {section === "report" && <ReportCapo {...props} />}
      {section === "archivio" && <ArchivioCapo {...props} />}
      </div>
    </main>
  );
}

/* ---------- Report mensili e annuali ---------- */
const REPORT_COLS = [
  { key: "presenze", label: "Presenze" },
  { key: "perc", label: "% pres." },
  { key: "H24", label: "H24" },
  { key: "gettone", label: "Gettone" },
  { key: "stazionamento", label: "Stazion." },
  { key: "equi1", label: "1° equi" },
  { key: "equi2", label: "2° equi", hot: true },
  { key: "d3", label: "D3", hot: true },
  { key: "centralino", label: "Centralino", hot: true },
  { key: "esuberi", label: "Esuberi" },
];
const MESI_LABEL = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];

function emptyRow() {
  return { presenze: 0, perc: 0, H24: 0, gettone: 0, stazionamento: 0, equi1: 0, equi2: 0, d3: 0, centralino: 0, esuberi: 0 };
}

// id dei turni già presenti nello storico importato (per non ricontarli)
const HIST_IDS = new Set(Object.keys(seedStorico.assignments || {}));

// mese "YYYY-MM" da un turnoId ("2026-05-15" o "2026-05-30:diurna")
function monthOfTurnoId(id) {
  return (id.endsWith(":diurna") ? id.slice(0, -":diurna".length) : id).slice(0, 7);
}

// estrae gli id delle persone in un equipaggio
function crewIds(c) {
  if (!c) return [];
  return [c.autista, c.capo, ...(c.soccorritori || [])].filter(Boolean);
}

// calcola i conteggi report dai turni ASSEGNATI IN APP e già passati (esclude lo storico importato).
// Regola: presenza 1/turno; +1 per equipaggio nella colonna; D3 = 2° equipaggio post se f3d3 include D3.
// Ritorna { [YYYY-MM]: { nturni, persone: { [cognome]: {counts} } } }
function computeReportsFromApp(turni, assignments, pById, availability) {
  const cognomeOf = (id) => pById[id]?.cognome || pById[id]?.name?.split(" ")[0];
  const out = {};
  const ensureMonth = (mk) => { if (!out[mk]) out[mk] = { nturni: 0, persone: {} }; return out[mk]; };
  const ensurePers = (mk, cog) => { const m = ensureMonth(mk); if (!m.persone[cog]) m.persone[cog] = emptyRow(); return m.persone[cog]; };

  turni.forEach((t) => {
    if (!isPast(t)) return;              // solo turni passati
    if (HIST_IDS.has(t.id)) return;      // lo storico importato è già nella base: non ricontarlo
    const a = assignments[t.id];
    if (!a) return;
    const mk = monthOfTurnoId(t.id);
    ensureMonth(mk).nturni += 1;
    const present = new Set();
    const assignedIds = new Set();
    const addCat = (id, cat) => {
      const cog = cognomeOf(id); if (!cog) return;
      ensurePers(mk, cog)[cat] += 1; present.add(cog); assignedIds.add(id);
    };
    // pre: [0]=H24, [1]=gettone, eventuale "Stazionamento"
    (a.pre || []).forEach((c, i) => {
      const cat = (c.name === "Stazionamento") ? "stazionamento" : (i === 0 ? "H24" : "gettone");
      crewIds(c).forEach((id) => addCat(id, cat));
    });
    // post: [0]=1equi, [1]=2equi
    (a.post || []).forEach((c, i) => {
      crewIds(c).forEach((id) => addCat(id, i === 0 ? "equi1" : "equi2"));
    });
    // D3: 2° equipaggio del post, solo se attivo
    if ((a.f3d3 || "").includes("D3") && (a.post || []).length > 1) {
      crewIds(a.post[1]).forEach((id) => { const cog = cognomeOf(id); if (cog) ensurePers(mk, cog).d3 += 1; });
    }
    // centralino
    const centr = a.centralino;
    const centrIds = Array.isArray(centr) ? centr : [...(centr?.pre?.people || []), ...(centr?.post?.people || [])];
    centrIds.filter(Boolean).forEach((id) => { addCat(id, "centralino"); });
    // presenze
    present.forEach((cog) => { ensurePers(mk, cog).presenze += 1; });
    // ESUBERI: disponibili (ENTRAMBE in una metà) ma non assegnati a nulla
    const av = (availability && availability[t.id]) || {};
    Object.keys(av).forEach((pid) => {
      const dispo = av[pid] && (av[pid].pre === "ENTRAMBE" || av[pid].post === "ENTRAMBE");
      if (dispo && !assignedIds.has(pid)) {
        const cog = cognomeOf(pid); if (cog) ensurePers(mk, cog).esuberi += 1;
      }
    });
  });
  return out;
}

// fonde base (storico/manuale) + auto (turni app). Le celle della base hanno precedenza se modificate a mano.
function mergeReports(base, auto) {
  const months = new Set([...Object.keys(base || {}), ...Object.keys(auto || {})]);
  const out = {};
  months.forEach((mk) => {
    const b = base?.[mk] || { nturni: 0, persone: {} };
    const au = auto?.[mk] || { nturni: 0, persone: {} };
    const persone = {};
    const cogs = new Set([...Object.keys(b.persone || {}), ...Object.keys(au.persone || {})]);
    cogs.forEach((cog) => {
      const rb = b.persone?.[cog] || emptyRow();
      const ra = au.persone?.[cog] || emptyRow();
      const row = {};
      Object.keys(emptyRow()).forEach((k) => { if (k !== "perc") row[k] = (rb[k] || 0) + (ra[k] || 0); });
      const nturni = (b.nturni || 0) + (au.nturni || 0);
      row.perc = nturni ? Math.round(100 * row.presenze / nturni) : 0;
      persone[cog] = row;
    });
    out[mk] = { nturni: (b.nturni || 0) + (au.nturni || 0), persone };
  });
  return out;
}

function ReportCapo({ turni, people, savePeople, reports, saveReports, imported, saveImported, galley, saveGalley, assignments, saveAssign, config, saveConfig, published, savePublished, availability }) {
  // mesi disponibili: quelli nei reports + il mese corrente
  const pById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const autoReports = useMemo(() => computeReportsFromApp(turni, assignments, pById, availability), [turni, assignments, pById, availability]);
  const merged = useMemo(() => mergeReports(reports, autoReports), [reports, autoReports]);
  const nowMonth = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  const monthKeys = useMemo(() => {
    const set = new Set(Object.keys(merged));
    set.add(nowMonth);
    return [...set].sort().reverse();
  }, [merged, nowMonth]);
  const [view, setView] = useState("mese"); // mese | anno
  const [month, setMonth] = useState(monthKeys[0] || nowMonth);
  const [year, setYear] = useState(String(new Date().getFullYear()));

  const importStorico = () => {
    // 1) anagrafica squadra (già pronta nel seed, con cognome/ruoli/vincoli)
    savePeople(JSON.parse(JSON.stringify(seedStorico.people)));

    // 2) turni storici archiviati: assegnazioni, config, cambusa, pubblicati
    saveAssign({ ...assignments, ...seedStorico.assignments });
    saveConfig({ ...config, ...seedStorico.config });
    savePublished({ ...published, ...seedStorico.published });

    // 3) cambusa: le date storiche sono già dentro i turni (galley per turnoId).
    //    Non serve duplicarle: galleyCounts le conta dai turni stessi.
    saveGalley({ ...galley, ...seedStorico.galley });

    // 4) report mensili
    saveReports({ ...reports, ...seedStorico.reports });

    saveImported({ done: true, at: new Date().toISOString() });
  };

  const setCell = (mk, cognome, col, value) => {
    const next = JSON.parse(JSON.stringify(reports));
    if (!next[mk]) next[mk] = { nturni: 0, persone: {} };
    if (!next[mk].persone[cognome]) next[mk].persone[cognome] = emptyRow();
    next[mk].persone[cognome][col] = Number(value) || 0;
    saveReports(next);
  };
  const setNturni = (mk, value) => {
    const next = JSON.parse(JSON.stringify(reports));
    if (!next[mk]) next[mk] = { nturni: 0, persone: {} };
    next[mk].nturni = Number(value) || 0;
    saveReports(next);
  };

  // cognomi da mostrare: quelli nei report fusi + tutta la squadra
  const cognomeOf = (p) => p.cognome || p.name.trim().split(" ")[0];
  const allCognomi = useMemo(() => {
    const set = new Set(people.map(cognomeOf));
    Object.values(merged).forEach((r) => Object.keys(r.persone || {}).forEach((c) => set.add(c)));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [people, merged]);

  // totale annuale: somma tutti i mesi dell'anno scelto (dai dati fusi)
  const annual = useMemo(() => {
    const out = {};
    Object.entries(merged).forEach(([mk, r]) => {
      if (!mk.startsWith(year + "-")) return;
      Object.entries(r.persone || {}).forEach(([cognome, v]) => {
        if (!out[cognome]) out[cognome] = emptyRow();
        REPORT_COLS.forEach((c) => { if (c.key !== "perc") out[cognome][c.key] += (v[c.key] || 0); });
      });
    });
    return out;
  }, [merged, year]);

  const years = useMemo(() => {
    const set = new Set(Object.keys(merged).map((k) => k.slice(0, 4)));
    set.add(String(new Date().getFullYear()));
    return [...set].sort().reverse();
  }, [merged]);

  const monthData = merged[month] || { nturni: 0, persone: {} };

  return (
    <>
      <div style={S.toolbar}>
        <div>
          <h2 style={{ ...S.h2, margin: 0 }}>Report</h2>
          <p style={{ ...S.helper, margin: "2px 0 0" }}>
            Somma lo storico importato e i turni che assegni in app (contati quando diventano passati). Dopomezza, centralino e D3 sono evidenziati: chi li fa va premiato. Le celle sono modificabili.
          </p>
        </div>
        <button className="tap" style={S.primaryBtn} onClick={() => {
          const msg = imported?.done
            ? "Ricarica lo storico aggiornato dal file (squadra, turni in archivio, report e cambusa da maggio). Sovrascrive i dati storici con quelli del file. Procedere?"
            : "Importa la squadra (26 persone con ruoli e vincoli), i turni storici in archivio, i report di maggio–luglio e lo storico cambuse. Sostituisce l'elenco attuale della squadra. Procedere?";
          if (window.confirm(msg)) importStorico();
        }}>{imported?.done ? "🔄 Ricarica storico" : "⬇️ Importa squadra e storico"}</button>
      </div>

      <div style={S.subnav}>
        <button className="tap" style={{ ...S.subnavBtn, ...(view === "mese" ? S.subnavOn : {}) }} onClick={() => setView("mese")}>Per mese</button>
        <button className="tap" style={{ ...S.subnavBtn, ...(view === "anno" ? S.subnavOn : {}) }} onClick={() => setView("anno")}>Totale annuale</button>
      </div>

      {view === "mese" ? (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <select style={S.slotSelect} value={month} onChange={(e) => setMonth(e.target.value)}>
              {monthKeys.map((mk) => {
                const [y, m] = mk.split("-");
                return <option key={mk} value={mk}>{MESI_LABEL[Number(m) - 1]} {y}</option>;
              })}
            </select>
            <label style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              n° turni:{" "}
              <input type="number" min="0" style={{ ...S.slotSelect, width: 70 }} value={monthData.nturni || 0}
                onChange={(e) => setNturni(month, e.target.value)} />
            </label>
          </div>
          <ReportTable
            cognomi={allCognomi}
            getRow={(c) => monthData.persone[c] || emptyRow()}
            editable
            onCell={(c, col, v) => setCell(month, c, col, v)}
          />
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <select style={S.slotSelect} value={year} onChange={(e) => setYear(e.target.value)}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <span style={S.helper}>Somma di tutti i mesi del {year}</span>
          </div>
          <ReportTable
            cognomi={allCognomi}
            getRow={(c) => annual[c] || emptyRow()}
            editable={false}
            hidePerc
          />
        </>
      )}
    </>
  );
}

function ReportTable({ cognomi, getRow, editable, onCell, hidePerc }) {
  const cols = hidePerc ? REPORT_COLS.filter((c) => c.key !== "perc") : REPORT_COLS;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={S.repTable}>
        <thead>
          <tr>
            <th style={{ ...S.repTh, textAlign: "left" }}>Cognome</th>
            {cols.map((c) => (
              <th key={c.key} style={{ ...S.repTh, ...(c.hot ? S.repThHot : {}) }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cognomi.map((cog) => {
            const row = getRow(cog);
            return (
              <tr key={cog}>
                <td style={{ ...S.repTd, textAlign: "left", fontWeight: 600 }}>{cog}</td>
                {cols.map((c) => (
                  <td key={c.key} style={{ ...S.repTd, ...(c.hot ? S.repTdHot : {}) }}>
                    {editable ? (
                      <input
                        type="number" min="0"
                        style={S.repInput}
                        value={row[c.key] || 0}
                        onChange={(e) => onCell(cog, c.key, e.target.value)}
                      />
                    ) : (
                      row[c.key] || 0
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Archivio: turni passati in sola lettura ---------- */
function ArchivioCapo({ turni, people, availability, assignments, crewsFor, published }) {
  const pById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const past = useMemo(() => {
    // unisci i turni generati con quelli storici importati (presenti in assignments/published)
    const byId = {};
    turni.forEach((t) => { byId[t.id] = t; });
    [...Object.keys(assignments || {}), ...Object.keys(published || {})].forEach((id) => {
      if (!byId[id]) byId[id] = turnoFromId(id);
    });
    return Object.values(byId)
      .filter((t) => !stillActive(t))
      .sort((a, b) => b.date - a.date);
  }, [turni, assignments, published]);
  const [open, setOpen] = useState(null);

  if (past.length === 0) {
    return (
      <>
        <h2 style={S.h2}>Archivio</h2>
        <p style={S.helper}>Qui finiranno i turni passati, con i loro equipaggi. Per ora non ce ne sono ancora.</p>
      </>
    );
  }

  return (
    <>
      <h2 style={S.h2}>Archivio turni passati</h2>
      <p style={{ ...S.helper, marginTop: -8, marginBottom: 16 }}>
        Turni già trascorsi, in sola lettura. Sono spariti dalla pagina delle disponibilità ma restano qui.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {past.map((t) => {
          const isOpen = open === t.id;
          const sheet = buildSheet(t, people, assignments, availability, crewsFor, pById);
          return (
            <div key={t.id} className="card-h" style={S.accordion}>
              <button style={S.accHead} onClick={() => setOpen(isOpen ? null : t.id)}>
                <span style={S.accDate}>{t.kind === "diurna" ? "☀️ " : ""}{t.label} {t.date.getFullYear()}</span>
                <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>{isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <div style={S.accBody}>
                  <SheetView turno={t} sheet={sheet} message={null} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------- generazione PDF (via stampa browser, nessuna libreria) ---------- */
function downloadSheetPDF(turno, sheet, message) {
  const esc = (s) => String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const tipo = turno.kind === "diurna" ? "DIURNA" : "NOTTURNA";
  const titolo = `${tipo} ${esc(turno.label.toUpperCase())} ${turno.date.getFullYear()}`;

  // una tabella-equipaggio in stile modello (header verde + riga orari + AV/CS/SOCC)
  const crewTable = (c) => {
    const orario = `In sede ore <b>${esc(c.inSede || "—")}</b> &nbsp; ${esc(c.fascia)}`;
    const cell = (s) =>
      s
        ? `<span class="${s.ext ? "rimp" : "nom"}">${esc(s.name)}${s.ext ? " (rimp.)" : ""}</span>`
        : `<span class="empty">— scoperto —</span>`;
    const soccRows = c.soccorritori.map((s) => `<tr><td class="rl">SOCC</td><td>${cell(s)}</td></tr>`).join("");
    return `
      <div class="crew">
        <div class="crewname">${esc(c.name)}</div>
        <table class="ct">
          <tr class="hdr"><td colspan="2">${orario}</td></tr>
          <tr><td class="rl">AV</td><td>${cell(c.autista)}</td></tr>
          <tr><td class="rl">CS</td><td>${cell(c.capo)}</td></tr>
          ${soccRows}
        </table>
      </div>`;
  };

  // equipaggi a coppie (due per riga, come il modello)
  const allCrews = [];
  sheet.halves.forEach((h) => h.crews.forEach((c) => allCrews.push(c)));
  let crewsHtml = "";
  for (let i = 0; i < allCrews.length; i += 2) {
    crewsHtml += `<div class="row2">${crewTable(allCrews[i])}${allCrews[i + 1] ? crewTable(allCrews[i + 1]) : "<div class='crew empty-slot'></div>"}</div>`;
  }

  // centralino per metà
  const centralHtml = (sheet.centralino || [])
    .map((c) => `<div class="cline"><b>CENTRALINO ${esc(c.orario || c.label)}:</b> ${c.people.map((s) => esc(s.name)).join("-")}</div>`)
    .join("");

  // cambusa
  const cambusaHtml = sheet.cambusa && sheet.cambusa.length
    ? `<div class="cambusa">🍕 <b>CAMBUSA:</b> ${sheet.cambusa.map(esc).join("-")}</div>`
    : "";

  // note in fondo
  const assentiTutte = MOTIVI_ORDER.flatMap((k) => sheet.byReason[k]).sort((a, b) => a.localeCompare(b));
  const noteRows = [];
  if (sheet.rimpiazzi && sheet.rimpiazzi.length) noteRows.push(`<div class="nrimp"><u>Rimpiazzi</u>: ${sheet.rimpiazzi.map(esc).join(", ")}</div>`);
  if (sheet.permessi && sheet.permessi.length) noteRows.push(`<div><u>Permessi</u>: ${sheet.permessi.map(esc).join(", ")}</div>`);
  if (assentiTutte.length) noteRows.push(`<div><u>Assenze giustificate</u>: ${assentiTutte.map(esc).join(", ")}</div>`);
  if (sheet.esuberi && sheet.esuberi.length) noteRows.push(`<div><u>Esuberi</u>: ${sheet.esuberi.map(esc).join(", ")}</div>`);
  const noteHtml = noteRows.length ? `<div class="note"><div class="notet">Note:</div>${noteRows.join("")}</div>` : "";

  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
  <title>${titolo}</title>
  <style>
    @page { margin: 16mm; }
    * { box-sizing: border-box; }
    body { font-family: Georgia, 'Times New Roman', serif; color:#1a1a1a; margin:0; }
    h1 { text-align:center; color:#2e7d32; font-size:26px; font-weight:700; margin:0 0 26px; letter-spacing:.5px; }
    .row2 { display:flex; gap:26px; margin-bottom:22px; page-break-inside:avoid; }
    .crew { flex:1; }
    .empty-slot { border:none; }
    .crewname { text-align:center; font-weight:700; font-size:18px; margin-bottom:6px; }
    table.ct { width:100%; border-collapse:collapse; }
    table.ct td { border:1px solid #6f6f6f; padding:7px 10px; font-size:14px; }
    table.ct td.rl { width:64px; font-weight:400; background:#fff; }
    tr.hdr td { background:#8bc48f; font-weight:400; font-size:12px; border:1px solid #6f6f6f; }
    .nom { color:#000; }
    .rimp { color:#c62828; font-weight:600; }
    .empty { color:#c62828; }
    td .nom, td .rimp { display:inline-block; text-align:center; width:100%; }
    table.ct td:nth-child(2) { text-align:center; color:#c62828; }
    table.ct tr:nth-child(2) td:nth-child(2) { color:#c62828; }
    .cline { font-size:14px; margin:8px 0; }
    .cambusa { font-size:14px; margin:16px 0 8px; }
    .note { margin-top:22px; font-size:13px; line-height:1.6; }
    .notet { margin-bottom:2px; }
    .nrimp { color:#c62828; }
    .msg { margin-top:16px; padding:12px 14px; background:#eef8f1; border-left:4px solid #2e7d32; font-style:italic; font-size:14px; }
    .foot { margin-top:22px; font-size:10px; color:#9aa7b3; }
    hr { border:none; border-top:1px solid #ccc; margin:20px 0; }
  </style></head><body>
    <h1>${titolo}</h1>
    ${crewsHtml}
    ${centralHtml ? `<hr>${centralHtml}` : ""}
    ${cambusaHtml}
    ${noteHtml}
    ${message && message.trim() ? `<div class="msg">${esc(message)}</div>` : ""}
    <div class="foot">Generato da Turni Squadra · Croceverde APM · ${new Date().toLocaleDateString("it-IT")}</div>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Abilita i popup per scaricare il PDF, oppure usa Stampa → Salva come PDF."); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 350);
}

/* ---------- helpers eleggibilità ---------- */
function eligibleFor(person, turnoId, half, availability) {
  const a = availability[turnoId]?.[person.id];
  if (!a) return false;
  const v = half === "pre" ? a.pre : a.post;
  return v === "ENTRAMBE"; // solo chi è realmente disponibile in quella metà
}
function canRole(person, role) {
  if (role === "autista") return person.roles.includes("autista");
  if (role === "capo") return person.roles.includes("capo");
  // soccorritore semplice: chi NON è autista né capo, oppure forzato
  return true;
}

/* ---------- auto-assegnazione greedy ---------- */
function autoAssign(turni, allPeople, availability, crewsFor) {
  const people = allPeople.filter((p) => !p.permesso);
  // conteggi per bilanciare carico
  const load = {};
  people.forEach((p) => (load[p.id] = 0));
  const result = {};

  for (const t of turni) {
    result[t.id] = { pre: [], post: [] };
    for (const half of ["pre", "post"]) {
      const nCrews = crewsFor(t.id, half);
      const used = new Set();
      const crews = [];
      for (let c = 0; c < nCrews; c++) {
        const crew = { autista: null, capo: null, soccorritori: [] };
        const avail = people.filter(
          (p) => eligibleFor(p, t.id, half, availability) && !used.has(p.id)
        );
        const pick = (pred) => {
          const cands = avail
            .filter((p) => !used.has(p.id) && pred(p))
            .sort((a, b) => load[a.id] - load[b.id]);
          if (cands.length) {
            const chosen = cands[0];
            used.add(chosen.id);
            load[chosen.id]++;
            return chosen.id;
          }
          return null;
        };
        crew.autista = pick((p) => p.roles.includes("autista"));
        crew.capo = pick((p) => p.roles.includes("capo"));
        // due soccorritori: preferisci chi NON è autista/capo
        let s1 = pick((p) => !p.roles.includes("autista") && !p.roles.includes("capo"));
        if (!s1) s1 = pick(() => true); // caso particolare: usa chiunque
        let s2 = pick((p) => !p.roles.includes("autista") && !p.roles.includes("capo"));
        if (!s2) s2 = pick(() => true);
        crew.soccorritori = [s1, s2].filter(Boolean);
        crews.push(crew);
      }
      result[t.id][half] = crews;
    }
  }
  return result;
}

/* ---------- auto cambusa con vincolo distanza ---------- */
/* ---------- statistiche "giro cambusa" ----------
   Dato l'elenco turni in ordine cronologico e le assegnazioni cambusa,
   calcola per ogni persona: quante volte ha portato (count) e a quanti
   turni fa risale l'ultima volta rispetto a un turno target (lastGap).
   Usato sia per proporre chi tocca, sia per avvisare se scegli chi l'ha
   portata da poco. Conta TUTTI i turni allo stesso modo. */
const GALLEY_RECENT = 3; // "da poco" = portata negli ultimi 3 turni

function galleyOrder(turni) {
  return [...turni].sort((a, b) => a.date - b.date);
}
function galleyCounts(turni, galley) {
  const order = galleyOrder(turni);
  const count = {};
  const lastIdx = {};
  const idxById = {}; // turnoId -> indice nell'ordine (per il "gap recente")
  order.forEach((t, idx) => { idxById[t.id] = idx; });

  // Conta OGNI voce cambusa una sola volta. Le chiavi possono essere:
  //  - un turnoId reale ("2026-05-05" o "2026-06-14:diurna")
  //  - una voce storica "histgalley:cognome:data:n" (solo se un turno non è nella lista)
  // Per evitare doppi conteggi: se una data ha già un turno reale con cambusa, ignoro l'eventuale histgalley della stessa data.
  const datesWithRealGalley = new Set();
  Object.keys(galley || {}).forEach((key) => {
    if (key.startsWith("histgalley:")) return;
    const d = key.endsWith(":diurna") ? key.slice(0, -":diurna".length) : key;
    if ((galley[key] || []).some(Boolean)) datesWithRealGalley.add(d);
  });

  Object.entries(galley || {}).forEach(([key, ids]) => {
    if (!key.startsWith("histgalley:")) return;
    const parts = key.split(":"); // histgalley : cognome : data : n
    const d = parts[2];
    if (datesWithRealGalley.has(d)) return; // già contata dal turno reale
    (ids || []).forEach((id) => { if (id) count[id] = (count[id] || 0) + 1; });
  });

  // turni reali (in ordine): contano e aggiornano il "gap"
  Object.entries(galley || {}).forEach(([key, ids]) => {
    if (key.startsWith("histgalley:")) return;
    (ids || []).forEach((id) => {
      if (!id) return;
      count[id] = (count[id] || 0) + 1;
      if (idxById[key] !== undefined) lastIdx[id] = idxById[key];
    });
  });
  return { order, count, lastIdx };
}
// da quanti turni una persona non porta la cambusa, rispetto al turno target
function galleyGapForPerson(turni, galley, turnoId, personId) {
  const { order, lastIdx } = galleyCounts(turni, galley);
  const targetIdx = order.findIndex((t) => t.id === turnoId);
  if (lastIdx[personId] === undefined) return Infinity; // mai portata
  return targetIdx - lastIdx[personId];
}

/* ===========================================================================
   HOTNESS — quanto una persona è "calda" per un posto scomodo (cambusa, centralino, D3)
   Alta (verde) = non lo fa da tanto o mai → tocca a lei. Bassa (rosso) = l'ha fatto da poco.
   Conta TUTTI i turni in ordine cronologico, storico incluso.
   =========================================================================== */

// estrae gli id delle persone che hanno svolto una certa attività in un turno
function extractCentralino(a) {
  const c = a?.centralino;
  if (!c) return [];
  if (Array.isArray(c)) return c.filter(Boolean);
  return [...(c.pre?.people || []), ...(c.post?.people || [])].filter(Boolean);
}
// D3 = chi è nel 2° equipaggio del dopo mezzanotte, MA solo se l'opzione D3 è attiva
function extractD3(a) {
  const f = (a?.f3d3 || "");
  if (!f.includes("D3")) return [];
  const crew2 = a?.post?.[1];
  if (!crew2) return [];
  return [crew2.autista, crew2.capo, ...(crew2.soccorritori || [])].filter(Boolean);
}
function extractGalleyFromAssign(a) { return []; } // la cambusa sta nel galley, gestita a parte

// conteggio generico su tutti i turni (storico + generati) per un estrattore su assignments
function activityCounts(turni, assignments, extractor) {
  const order = galleyOrder(turni);
  const count = {}; const lastIdx = {};
  order.forEach((t, idx) => {
    extractor(assignments[t.id]).forEach((id) => {
      count[id] = (count[id] || 0) + 1;
      lastIdx[id] = idx;
    });
  });
  return { order, count, lastIdx };
}

// hotness 0..1 per una persona: 1 = mai fatto (caldissimo), scende se l'ha fatto di recente
function hotnessFrom(order, lastIdx, count, turnoId, personId) {
  const targetIdx = order.findIndex((t) => t.id === turnoId);
  const li = lastIdx[personId];
  if (li === undefined) return 1; // mai fatto → massimo
  const gap = Math.max(0, (targetIdx < 0 ? order.length : targetIdx) - li);
  // gap 0 (appena fatto) → ~0 ; gap grande → verso 1. Saturazione a ~6 turni.
  return Math.min(1, gap / 6);
}

// colore da hotness: verde (caldo) → giallo → rosso (freddo)
function hotColor(h) {
  if (h >= 0.66) return "#1fae5a";      // verde: tocca a lui
  if (h >= 0.33) return "#f0a830";      // giallo: intermedio
  return "#e2574c";                      // rosso: l'ha fatto da poco
}
function hotLabel(h, count) {
  const c = count || 0;
  if (h >= 0.99 && c === 0) return "mai fatto";
  if (h >= 0.66) return "tocca a lui/lei";
  if (h >= 0.33) return "intermedio";
  return "fatto da poco";
}

// pallino + barra colorata che indica la hotness (verde=tocca a lui, rosso=fatto da poco)
function HotDot({ h, count, title }) {
  const color = hotColor(h);
  return (
    <span title={title || `${hotLabel(h, count)}${count != null ? ` · fatto ${count}×` : ""}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 5px ${color}66` }} />
      <span style={{ display: "inline-block", width: 34, height: 5, borderRadius: 3, background: "var(--panel-2)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.round(h * 100)}%`, background: color }} />
      </span>
      {count != null && <span style={{ fontSize: 10, color: "var(--ink-soft)" }}>{count}×</span>}
    </span>
  );
}

function autoGalley(turni, people, availability, existing) {
  const order = galleyOrder(turni);
  const lastIndex = {}; // personId -> ultimo indice turno in cui ha portato
  const count = {};     // personId -> volte totali
  const out = {};
  order.forEach((t, idx) => {
    const present = people.filter((p) => {
      if (p.permesso) return false;
      const a = availability[t.id]?.[p.id];
      return a && (a.pre === "ENTRAMBE" || a.post === "ENTRAMBE");
    });
    // ordina per: chi è più indietro nel giro (gap grande), poi chi ha portato meno volte
    const ranked = present
      .map((p) => ({
        id: p.id,
        gap: lastIndex[p.id] === undefined ? 999 : idx - lastIndex[p.id],
        count: count[p.id] || 0,
      }))
      .sort((a, b) => b.gap - a.gap || a.count - b.count);
    const chosen = ranked.slice(0, 2).map((r) => r.id);
    chosen.forEach((id) => { lastIndex[id] = idx; count[id] = (count[id] || 0) + 1; });
    out[t.id] = chosen;
  });
  return out;
}

/* ---------- vista turni caposquadra ---------- */
function TurniCapo({ turni, people, availability, assignments, saveAssign, galley, saveGalley, config, saveConfig, crewsFor, alerts, saveAlerts, published, savePublished }) {
  const [open, setOpen] = useState(turni[0]?.id);
  const pById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);

  const runAuto = () => {
    saveAssign(autoAssign(turni, people, availability, crewsFor));
    saveGalley(autoGalley(turni, people, availability, galley));
  };

  const setCrews = (turnoId, half, n) => {
    const v = Math.max(0, Math.min(6, n));
    const next = JSON.parse(JSON.stringify(config));
    if (!next[turnoId]) next[turnoId] = {};
    next[turnoId][half] = v;
    saveConfig(next);
  };

  const toggleAlert = (turnoId) => {
    const next = JSON.parse(JSON.stringify(alerts));
    const cur = next[turnoId] || { active: false, resolved: {} };
    cur.active = !cur.active;
    next[turnoId] = cur;
    saveAlerts(next);
    if (cur.active) {
      const t = turni.find((x) => x.id === turnoId);
      const msg = t
        ? `🔴 SERVE UN RIMPIAZZO — turno ${t.label}\nSiamo scoperti: chi è assente cerchi un sostituto. Aggiornate le disponibilità sull'app. Grazie!`
        : "🔴 Serve un rimpiazzo per un turno scoperto. Controllate l'app.";
      shareWhatsApp(msg);
    }
  };

  return (
    <>
      <div style={S.toolbar}>
        <div>
          <h2 style={{ ...S.h2, margin: 0 }}>Turni & equipaggi</h2>
          <p style={{ ...S.helper, margin: "2px 0 0" }}>Imposta quanti equipaggi servono per ogni metà (default {EQUIPAGGI_PER_META}+{EQUIPAGGI_PER_META}). Ogni equipaggio è autista + capo + 2 soccorritori.</p>
        </div>
        <button className="tap" style={S.primaryBtn} onClick={runAuto}>⚡ Genera proposta automatica</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {turni.filter((t) => stillActive(t)).map((t) => {
          const isOpen = open === t.id;
          const a = assignments[t.id];
          const stats = coverageStats(t, a, crewsFor);
          const al = alerts[t.id];
          const subsFound = al ? Object.entries(al.resolved || {}).filter(([, r]) => r.sub && r.sub.trim()) : [];
          return (
            <div key={t.id} className="card-h" style={S.accordion}>
              <button style={S.accHead} onClick={() => setOpen(isOpen ? null : t.id)}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <span style={S.accDate}>{t.kind === "diurna" ? "☀️ " : ""}{t.label}</span>
                  {t.kind === "diurna" && <span style={S.diurnaTag}>diurna · da {t.parentLabel}</span>}
                  <CoverageBadge stats={stats} />
                  {al?.active && <span style={S.alertTag}>🔴 rimpiazzo richiesto</span>}
                </div>
                <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>
                  presenti: {presentCount(t, availability)} · {isOpen ? "▲" : "▼"}
                </span>
              </button>
              {isOpen && (
                <div style={S.accBody}>
                  {t.kind === "notte" && t.diurnaWE && (
                    <div style={S.weNoteCapo}>
                      ☀️ Con questo turno c'è anche la <b>diurna di {t.diurnaLabel}</b> (lo trovi come turno separato qui in elenco).
                    </div>
                  )}

                  {HALF_KEYS.map((half) => {
                    const nCrews = crewsFor(t.id, half);
                    const hl = `${halfIcon(t, half)} ${halfLabel(t, half)}`;
                    return (
                      <div key={half} style={{ marginBottom: 18 }}>
                        <div style={S.halfTitleRow}>
                          <div style={S.halfTitle}>{hl}</div>
                          <div style={S.stepper}>
                            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>equipaggi</span>
                            <button style={S.stepBtn} onClick={() => setCrews(t.id, half, nCrews - 1)}>−</button>
                            <span style={S.stepVal}>{nCrews}</span>
                            <button style={S.stepBtn} onClick={() => setCrews(t.id, half, nCrews + 1)}>+</button>
                          </div>
                        </div>
                        {nCrews === 0 ? (
                          <div style={S.helper}>Nessun equipaggio richiesto.</div>
                        ) : (
                          <div style={S.crewGrid}>
                            {Array.from({ length: nCrews }).map((_, ci) => (
                              <CrewEditor
                                key={ci}
                                turno={t}
                                half={half}
                                crewIndex={ci}
                                crew={a?.[half]?.[ci]}
                                people={people}
                                pById={pById}
                                availability={availability}
                                assignments={assignments}
                                saveAssign={saveAssign}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <CentralinoEditor
                    turno={t}
                    turni={turni}
                    people={people}
                    pById={pById}
                    availability={availability}
                    assignments={assignments}
                    saveAssign={saveAssign}
                  />

                  <AbsentDetails turno={t} people={people} availability={availability} />

                  <F3D3Toggle turno={t} turni={turni} assignments={assignments} saveAssign={saveAssign} pById={pById} />

                  <div style={S.alertControlRow}>
                    <button
                      style={{ ...S.alertBtn, ...(al?.active ? S.alertBtnOn : {}) }}
                      onClick={() => toggleAlert(t.id)}
                    >
                      {al?.active ? "✓ Avviso rimpiazzo attivo — annulla" : "💬 Avvisa \"cerca rimpiazzo!\" su WhatsApp"}
                    </button>
                    {al?.active && (
                      <span style={S.helper}>
                        Chi è assente su questo turno vedrà l'avviso aprendo l'app.
                      </span>
                    )}
                  </div>

                  {al?.active && subsFound.length > 0 && (
                    <div style={S.subsRecap}>
                      <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>Rimpiazzi trovati dai compagni</div>
                      {subsFound.map(([pid, r]) => (
                        <div key={pid} style={S.subRow}>
                          <span style={{ color: "var(--ink-soft)" }}>{pById[pid]?.name || pid}:</span>
                          <b>{r.sub}</b>
                          <span style={S.extTag}>{RUOLI[r.role] || r.role}{r.squad ? ` · ${r.squad}` : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <GalleyEditor
                    turno={t}
                    turni={turni}
                    people={people}
                    pById={pById}
                    availability={availability}
                    galley={galley}
                    saveGalley={saveGalley}
                  />

                  <PublishBlock
                    turno={t}
                    people={people}
                    pById={pById}
                    availability={availability}
                    assignments={assignments}
                    crewsFor={crewsFor}
                    galley={galley}
                    published={published}
                    savePublished={savePublished}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------- blocco pubblicazione + PDF ---------- */
function PublishBlock({ turno, people, pById, availability, assignments, crewsFor, galley, published, savePublished }) {
  const pub = published[turno.id];
  const [msg, setMsg] = useState(pub?.message || "");
  const sheet = useMemo(
    () => buildSheet(turno, people, assignments, availability, crewsFor, pById),
    [turno, people, assignments, availability, crewsFor, pById]
  );
  // nomi cambusa per questo turno
  const cambusa = useMemo(
    () => (galley[turno.id] || []).map((id) => pById[id]?.name).filter(Boolean),
    [galley, turno.id, pById]
  );
  const sheetFull = { ...sheet, cambusa };

  const buildTextSummary = () => {
    const lines = [`📋 EQUIPAGGI — ${turno.label} ${turno.date.getFullYear()}`, ""];
    sheet.halves.forEach((h) => {
      if (!h.crews.length) return;
      lines.push(`${halfIcon(turno, h.key)} ${h.label}`);
      h.crews.forEach((c) => {
        const orario = `${c.inSede ? `in sede ${c.inSede}, ` : ""}${c.fascia}`;
        lines.push(`  ${c.name} (${orario}):`);
        const line = (role, s) => lines.push(`   • ${role}: ${s ? s.name + (s.ext ? " (rimpiazzo)" : "") : "— scoperto —"}`);
        line("Autista", c.autista);
        line("Capo", c.capo);
        c.soccorritori.forEach((s, i) => line(c.soccorritori.length === 1 ? "Soccorritore" : `Soccorritore ${i + 1}`, s));
      });
      lines.push("");
    });
    if (sheet.centralino && sheet.centralino.length) {
      sheet.centralino.forEach((c) => {
        lines.push(`☎️ Centralino ${c.label}${c.orario ? ` ${c.orario}` : ""}: ${c.people.map((s) => s.name).join(", ")}`);
      });
      lines.push("");
    }
    if (cambusa.length) { lines.push(`🍝 Cambusa: ${cambusa.join(", ")}`); lines.push(""); }
    const anyAbsent = MOTIVI_ORDER.some((k) => sheet.byReason[k].length);
    if (anyAbsent) {
      lines.push("Assenti:");
      MOTIVI_ORDER.forEach((k) => {
        if (sheet.byReason[k].length) lines.push(`  ${MOTIVI[k].label}: ${sheet.byReason[k].join(", ")}`);
      });
      lines.push("");
    }
    if (sheet.permessi && sheet.permessi.length) { lines.push(`Permessi: ${sheet.permessi.join(", ")}`); }
    if (sheet.esuberi && sheet.esuberi.length) { lines.push(`Esuberi: ${sheet.esuberi.join(", ")}`); }
    if (msg && msg.trim()) { lines.push(""); lines.push(msg.trim()); }
    return lines.join("\n");
  };

  const publish = () => {
    const next = { ...published, [turno.id]: { at: new Date().toISOString(), message: msg } };
    savePublished(next);
    shareWhatsApp(buildTextSummary());
  };
  const unpublish = () => {
    const next = { ...published };
    delete next[turno.id];
    savePublished(next);
  };

  return (
    <div style={S.publishBox}>
      <div style={S.publishTitle}>📋 Foglio del turno</div>
      <p style={{ ...S.helper, margin: "0 0 10px" }}>
        Quando gli equipaggi sono pronti, scrivi una frase di chiusura (facoltativa) e pubblica: i compagni la vedranno in app. Puoi anche scaricare il PDF.
      </p>
      <textarea
        style={S.publishMsg}
        rows={2}
        placeholder="Frase di chiusura (es. «Grazie a tutti, buon turno e occhi aperti!»)"
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
      />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        {pub ? (
          <>
            <button className="tap" style={S.primaryBtn} onClick={publish}>Aggiorna pubblicazione</button>
            <button style={S.ghostBtn} onClick={unpublish}>Ritira</button>
          </>
        ) : (
          <button className="tap" style={S.primaryBtn} onClick={publish}>✅ Pubblica e invia su WhatsApp</button>
        )}
        <button style={S.ghostBtn} onClick={() => downloadSheetPDF(turno, sheetFull, msg)}>⬇️ Scarica PDF</button>
      </div>
      {pub && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--c-both)" }}>
          ✓ Pubblicato — visibile ai compagni in app.
        </div>
      )}
      {sheet.notResponded.length > 0 && (
        <div style={S.noResp}>
          ⚠️ Non hanno ancora risposto (esclusi dal foglio): <b>{sheet.notResponded.join(", ")}</b>
        </div>
      )}
    </div>
  );
}

function presentCount(t, availability) {
  const av = availability[t.id] || {};
  return Object.values(av).filter((a) => a.pre === "ENTRAMBE" || a.post === "ENTRAMBE").length;
}
function coverageStats(t, a, crewsFor) {
  let filled = 0;
  let total = 0;
  for (const half of ["pre", "post"]) {
    const nCrews = crewsFor(t.id, half);
    const crews = a?.[half] || [];
    for (let i = 0; i < nCrews; i++) {
      const c = crews[i];
      const size = c?.size || 4;
      total += size;
      if (c) {
        if (c.autista) filled++;
        if (c.capo) filled++;
        const need = size - 2;
        filled += (c.soccorritori || []).filter(Boolean).slice(0, need).length;
      }
    }
  }
  return { filled, total };
}
function CoverageBadge({ stats }) {
  const pct = stats.total ? stats.filled / stats.total : 0;
  const color = pct >= 1 ? "var(--c-both)" : pct >= 0.5 ? "var(--c-post)" : "var(--c-absent)";
  return (
    <span style={{ ...S.badge, borderColor: color, color }}>
      {stats.filled}/{stats.total} posti
    </span>
  );
}

/* ---------- editor singolo equipaggio ---------- */
function CrewEditor({ turno, half, crewIndex, crew, people, pById, availability, assignments, saveAssign }) {
  const c = crew || { autista: null, capo: null, soccorritori: [], size: 4 };
  const size = c.size || (c.soccorritori?.length === 1 ? 3 : 4); // 3 o 4
  const nSocc = size - 2; // 1 o 2 soccorritori

  const setSlot = (role, idx, value) => {
    const next = JSON.parse(JSON.stringify(assignments));
    if (!next[turno.id]) next[turno.id] = { pre: [], post: [] };
    if (!next[turno.id][half]) next[turno.id][half] = [];
    while (next[turno.id][half].length <= crewIndex)
      next[turno.id][half].push({ autista: null, capo: null, soccorritori: [], size: 4 });
    const target = next[turno.id][half][crewIndex];
    if (role === "soccorritori") {
      target.soccorritori = target.soccorritori || [];
      target.soccorritori[idx] = value || null;
      target.soccorritori = target.soccorritori.filter((x, i) => i < 2);
    } else {
      target[role] = value || null;
    }
    saveAssign(next);
  };

  const setSize = (newSize) => {
    const s = Math.max(3, Math.min(4, newSize));
    const next = JSON.parse(JSON.stringify(assignments));
    if (!next[turno.id]) next[turno.id] = { pre: [], post: [] };
    if (!next[turno.id][half]) next[turno.id][half] = [];
    while (next[turno.id][half].length <= crewIndex)
      next[turno.id][half].push({ autista: null, capo: null, soccorritori: [], size: 4 });
    const target = next[turno.id][half][crewIndex];
    target.size = s;
    if (s === 3) {
      target.soccorritori = (target.soccorritori || []).slice(0, 1); // tolgo il 2°
    }
    saveAssign(next);
  };

  const setField = (field, value) => {
    const next = JSON.parse(JSON.stringify(assignments));
    if (!next[turno.id]) next[turno.id] = { pre: [], post: [] };
    if (!next[turno.id][half]) next[turno.id][half] = [];
    while (next[turno.id][half].length <= crewIndex)
      next[turno.id][half].push({ autista: null, capo: null, soccorritori: [], size: 4 });
    next[turno.id][half][crewIndex][field] = value;
    saveAssign(next);
  };

  // chi è disponibile in questa metà, escludendo già assegnati altrove nello stesso turno+metà
  const assignedElsewhere = useMemo(() => {
    const set = new Set();
    const halfData = assignments[turno.id]?.[half] || [];
    halfData.forEach((cr, i) => {
      if (i === crewIndex) return;
      if (cr.autista) set.add(cr.autista);
      if (cr.capo) set.add(cr.capo);
      (cr.soccorritori || []).forEach((s) => s && set.add(s));
    });
    return set;
  }, [assignments, turno.id, half, crewIndex]);

  const optionsFor = (role, currentVal) =>
    people
      .filter((p) => eligibleFor(p, turno.id, half, availability))
      .filter((p) => canRole(p, role))
      .filter((p) => !assignedElsewhere.has(p.id) || p.id === currentVal);

  return (
    <div style={S.crewCard}>
      <div style={S.crewHeadRow}>
        <input
          style={S.crewNameInput}
          value={c.name ?? defaultCrewName(turno, half, crewIndex)}
          onChange={(e) => setField("name", e.target.value)}
          title="Nome equipaggio (modificabile)"
        />
        <div style={S.sizeToggle}>
          <button style={{ ...S.sizeBtn, ...(size === 3 ? S.sizeBtnOn : {}) }} onClick={() => setSize(3)}>3</button>
          <button style={{ ...S.sizeBtn, ...(size === 4 ? S.sizeBtnOn : {}) }} onClick={() => setSize(4)}>4</button>
        </div>
      </div>
      <div style={S.crewTimesRow}>
        <input
          style={S.crewTimeInput}
          value={c.inSede ?? ""}
          onChange={(e) => setField("inSede", e.target.value)}
          placeholder="In sede ore…"
          title="Orario di ritrovo in sede"
        />
        <input
          style={S.crewTimeInput}
          value={c.fascia ?? defaultFascia(turno, half)}
          onChange={(e) => setField("fascia", e.target.value)}
          placeholder="Fascia (es. 20:00-00:00)"
          title="Fascia oraria del turno"
        />
      </div>
      <SlotSelect
        label="Autista" icon="🚑" role="autista"
        value={c.autista}
        options={optionsFor("autista", c.autista)}
        onChange={(v) => setSlot("autista", null, v)}
      />
      <SlotSelect
        label="Capoequipaggio" icon="⭐" role="capo"
        value={c.capo}
        options={optionsFor("capo", c.capo)}
        onChange={(v) => setSlot("capo", null, v)}
      />
      {Array.from({ length: nSocc }).map((_, i) => (
        <SlotSelect
          key={i}
          label={nSocc === 1 ? "Soccorritore" : `Soccorritore ${i + 1}`} icon="🧑‍⚕️" role="soccorritore"
          value={c.soccorritori?.[i] || null}
          options={optionsFor("soccorritore", c.soccorritori?.[i])}
          onChange={(v) => setSlot("soccorritori", i, v)}
          warnDoubleRole={(pid) => {
            const p = pById[pid];
            return p && (p.roles.includes("autista") || p.roles.includes("capo"));
          }}
        />
      ))}
    </div>
  );
}

// codifica rimpiazzo esterno come stringa "ext:Nome|Squadra"
function isExt(v) { return typeof v === "string" && v.startsWith("ext:"); }
function parseExt(v) {
  const [name, squad] = v.slice(4).split("|");
  return { name: name || "Esterno", squad: squad || "" };
}

// risolve il nome di uno slot (persona interna o rimpiazzo esterno)
function slotName(v, pById) {
  if (!v) return null;
  if (isExt(v)) { const e = parseExt(v); return { name: e.name, ext: true, squad: e.squad }; }
  const p = pById[v];
  return p ? { name: p.name, ext: false } : null;
}

// costruisce i dati del foglio per un turno: equipaggi + assenti raggruppati per motivo + non risposto
function buildSheet(turno, people, assignments, availability, crewsFor, pById) {
  const halfDefs = HALF_KEYS.map((key) => ({ key, label: halfLabel(turno, key) }));
  const halves = halfDefs.map((h) => {
    // numero equipaggi: il massimo tra quelli previsti (config) e quelli realmente salvati nei dati
    const configured = crewsFor(turno.id, h.key);
    const saved = (assignments[turno.id]?.[h.key] || []).length;
    const nCrews = Math.max(configured, saved);
    const crews = [];
    for (let i = 0; i < nCrews; i++) {
      const c = assignments[turno.id]?.[h.key]?.[i] || { autista: null, capo: null, soccorritori: [], size: 4 };
      const size = c.size || 4;
      const need = size - 2;
      crews.push({
        n: i + 1,
        name: c.name || defaultCrewName(turno, h.key, i),
        inSede: c.inSede || "",
        fascia: c.fascia || defaultFascia(turno, h.key),
        autista: slotName(c.autista, pById),
        capo: slotName(c.capo, pById),
        soccorritori: Array.from({ length: need }).map((_, j) => slotName(c.soccorritori?.[j], pById)).filter(Boolean),
      });
    }
    return { ...h, crews };
  });

  // centralino diviso per metà (pre/post), ciascuna con orario e persone.
  // Retrocompatibilità: se esiste il vecchio formato array, lo metto in "pre".
  const rawCentr = assignments[turno.id]?.centralino;
  const centrData = Array.isArray(rawCentr)
    ? { pre: { people: rawCentr, orario: "" }, post: { people: [], orario: "" } }
    : (rawCentr || {});

  // assenti raggruppati per motivo (solo chi NON è in permesso e ha messo "assente" su tutto)
  const byReason = { lavoro: [], studio: [], sanitaria: [], altro: [] };
  const absentDetails = []; // per il caposquadra: nome + motivo + commento privato
  const notResponded = [];
  people.forEach((p) => {
    if (p.permesso) return; // i permessi non compaiono
    const a = availability[turno.id]?.[p.id];
    if (!a) { notResponded.push(p.name); return; }
    const fullyAbsent = a.pre === "ASSENTE" && a.post === "ASSENTE";
    if (fullyAbsent) {
      const r = MOTIVI[a.reason] ? a.reason : "altro";
      byReason[r].push(p.name);
      absentDetails.push({ name: p.name, reason: r, note: a.note || "" });
    }
  });
  Object.keys(byReason).forEach((k) => byReason[k].sort((x, y) => x.localeCompare(y)));
  absentDetails.sort((a, b) => a.name.localeCompare(b.name));
  notResponded.sort((x, y) => x.localeCompare(y));

  const centralino = HALF_KEYS.map((key) => ({
    key,
    label: halfLabel(turno, key),
    orario: centrData[key]?.orario || "",
    people: (centrData[key]?.people || []).map((cid) => slotName(cid, pById)).filter(Boolean),
  })).filter((c) => c.people.length > 0);

  // persone in permesso (per la sezione Note)
  const permessi = people.filter((p) => p.permesso).map((p) => p.name).sort((a, b) => a.localeCompare(b));

  // rimpiazzi esterni usati negli equipaggi (nome + eventuale squadra)
  const rimpiazzi = [];
  halves.forEach((h) => h.crews.forEach((c) => {
    [c.autista, c.capo, ...c.soccorritori].forEach((s) => {
      if (s && s.ext) rimpiazzi.push(s.name + (s.squad ? ` (${s.squad})` : ""));
    });
  }));

  // ESUBERI: chi ha dato disponibilità (almeno una metà ENTRAMBE) ma NON è in equipaggio né al centralino
  const assignedIds = new Set();
  ["pre", "post"].forEach((half) => {
    (assignments[turno.id]?.[half] || []).forEach((c) => {
      [c.autista, c.capo, ...(c.soccorritori || [])].forEach((id) => { if (id) assignedIds.add(id); });
    });
  });
  // centralino (entrambi i formati)
  const cc = assignments[turno.id]?.centralino;
  if (Array.isArray(cc)) cc.forEach((id) => id && assignedIds.add(id));
  else if (cc) ["pre", "post"].forEach((h) => (cc[h]?.people || []).forEach((id) => id && assignedIds.add(id)));

  const esuberi = [];
  people.forEach((p) => {
    const a = availability[turno.id]?.[p.id];
    if (!a) return; // chi non ha risposto è già in notResponded (i permessi che non rispondono restano fuori)
    const disponibile = a.pre === "ENTRAMBE" || a.post === "ENTRAMBE";
    if (disponibile && !assignedIds.has(p.id)) esuberi.push(p.name);
  });
  esuberi.sort((x, y) => x.localeCompare(y));

  return { halves, byReason, absentDetails, notResponded, centralino, permessi, rimpiazzi, esuberi };
}

// nome di default per un equipaggio (H24, Gettone 1, ...) — modificabile dal capo
function defaultCrewName(turno, half, index) {
  if (isDiurnaTurno(turno)) return `${index + 1}° Equipaggio`;
  // notturna: prima metà = H24 / Gettone, seconda metà = 1°/2° Equipaggio (come nel modello)
  if (half === "pre") return index === 0 ? "H24" : `Gettone ${index}`;
  return `${index + 1}° Equipaggio`;
}
// fascia oraria di default
function defaultFascia(turno, half) {
  if (isDiurnaTurno(turno)) return half === "pre" ? "08:00-14:00" : "14:00-20:00";
  return half === "pre" ? "20:00-00:00" : "00:00-06:00";
}

// vista del foglio (usata in-app per i compagni)
function SheetView({ turno, sheet, message }) {
  const renderSlot = (role, s) =>
    s ? (
      <div key={role + s.name} style={S.sheetSlot}>
        <span style={S.sheetRole}>{role}</span>
        <span>{s.name}{s.ext && <span style={S.sheetExt}> · rimpiazzo{s.squad ? ` (${s.squad})` : ""}</span>}</span>
      </div>
    ) : (
      <div key={role + Math.random()} style={S.sheetSlot}>
        <span style={S.sheetRole}>{role}</span>
        <span style={{ color: "var(--c-absent)" }}>— scoperto —</span>
      </div>
    );

  const anyAbsent = MOTIVI_ORDER.some((k) => sheet.byReason[k].length);

  return (
    <div style={S.sheet}>
      <div style={S.sheetTitle}>Equipaggi · <span style={{ textTransform: "capitalize" }}>{turno.label} {turno.date.getFullYear()}</span></div>

      {sheet.halves.map((h) => (
        <div key={h.key} style={{ marginBottom: 16 }}>
          <div style={S.sheetHalf}>{halfIcon(turno, h.key)} {h.label}</div>
          <div style={S.sheetCrews}>
            {h.crews.length === 0 && <div style={S.helper}>Nessun equipaggio.</div>}
            {h.crews.map((c) => (
              <div key={c.n} style={S.sheetCrew}>
                <div style={S.sheetCrewN}>{c.name}</div>
                <div style={S.sheetTimes}>
                  {c.inSede ? `In sede ore ${c.inSede} · ` : ""}{c.fascia}
                </div>
                {renderSlot("Autista", c.autista)}
                {renderSlot("Capo", c.capo)}
                {c.soccorritori.map((s, i) => renderSlot(c.soccorritori.length === 1 ? "Soccorritore" : `Soccorritore ${i + 1}`, s))}
              </div>
            ))}
          </div>
        </div>
      ))}

      {sheet.centralino && sheet.centralino.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={S.sheetHalf}>☎️ Centralino</div>
          {sheet.centralino.map((c) => (
            <div key={c.key} style={S.sheetCentralino}>
              <b>{c.label}{c.orario ? ` (${c.orario})` : ""}:</b> {c.people.map((s) => s.name).join(" · ")}
            </div>
          ))}
        </div>
      )}

      {anyAbsent && (
        <div style={{ marginTop: 10 }}>
          <div style={S.sheetHalf}>Assenti</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {MOTIVI_ORDER.map((k) =>
              sheet.byReason[k].length ? (
                <div key={k} style={S.absGroup}>
                  <div style={S.absGroupTitle}>{MOTIVI[k].icon} {MOTIVI[k].label}</div>
                  {sheet.byReason[k].map((n) => <div key={n} style={S.absName}>{n}</div>)}
                </div>
              ) : null
            )}
          </div>
        </div>
      )}

      {sheet.esuberi && sheet.esuberi.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={S.sheetHalf}>🔄 Esuberi <span style={{ fontSize: 12, fontWeight: 400, color: "var(--ink-soft)" }}>(disponibili non impiegati)</span></div>
          <div style={S.sheetCentralino}>{sheet.esuberi.join(" · ")}</div>
        </div>
      )}

      {message && message.trim() && (
        <div style={S.sheetMsg}>{message}</div>
      )}
    </div>
  );
}

function SlotSelect({ label, icon, value, options, onChange, warnDoubleRole }) {
  const ext = isExt(value);
  const showWarn = !ext && warnDoubleRole && value && warnDoubleRole(value);

  const addExternal = () => {
    const name = window.prompt("Nome del rimpiazzo esterno:");
    if (!name) return;
    const squad = window.prompt("Da quale squadra arriva? (facoltativo)") || "";
    onChange(`ext:${name.trim()}|${squad.trim()}`);
  };

  if (ext) {
    const e = parseExt(value);
    return (
      <div style={S.slot}>
        <span style={S.slotLabel}>{icon} {label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-end" }}>
          <span style={S.extChip} title={e.squad ? `da ${e.squad}` : "rimpiazzo esterno"}>
            🔁 {e.name}{e.squad ? ` · ${e.squad}` : ""}
          </span>
          <button style={S.extRemove} onClick={() => onChange("")} title="Rimuovi">✕</button>
        </div>
      </div>
    );
  }

  return (
    <div style={S.slot}>
      <span style={S.slotLabel}>{icon} {label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-end" }}>
        {showWarn && <span title="Autista/capo usato come soccorritore" style={S.warnDot}>!</span>}
        <select
          style={S.slotSelect}
          value={value || ""}
          onChange={(e) => { if (e.target.value === "__ext__") addExternal(); else onChange(e.target.value); }}
        >
          <option value="">— vuoto —</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          <option value="__ext__">+ Rimpiazzo da altra squadra…</option>
        </select>
      </div>
    </div>
  );
}

/* ---------- toggle F3/D3 (notte divisa in due, turno "sfortunato") ---------- */
function F3D3Toggle({ turno, turni, assignments, saveAssign, pById }) {
  const cur = assignments[turno.id]?.f3d3 || "";
  const set = (val) => {
    const next = JSON.parse(JSON.stringify(assignments));
    if (!next[turno.id]) next[turno.id] = { pre: [], post: [] };
    next[turno.id].f3d3 = next[turno.id].f3d3 === val ? "" : val;
    saveAssign(next);
  };
  const opts = turno.kind === "diurna" ? [["D3", "D3 (pomeriggio diviso)"]] : [["F3", "F3 (prima metà divisa)"], ["D3", "D3 (seconda metà divisa)"], ["F3/D3", "Entrambe"]];

  // hotness D3 su tutti i turni (chi ha fatto il D3 = 2° equipaggio post nei turni con D3 attivo)
  const { order, count, lastIdx } = useMemo(
    () => activityCounts(turni, assignments, extractD3),
    [turni, assignments]
  );
  const isActive = cur.includes("D3");
  // chi è nel 2° equipaggio del dopo mezzanotte (quelli che faranno il D3)
  const crew2 = assignments[turno.id]?.post?.[1];
  const d3people = crew2 ? [crew2.autista, crew2.capo, ...(crew2.soccorritori || [])].filter(Boolean) : [];

  return (
    <div style={S.f3d3Box}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={S.f3d3Label}>🌗 Notte divisa (turno sfortunato):</span>
        {opts.map(([val, lbl]) => (
          <button key={val} className="tap"
            style={{ ...S.f3d3Btn, ...(cur === val ? S.f3d3BtnOn : {}) }}
            onClick={() => set(val)}>{lbl}</button>
        ))}
        {cur && <span style={S.f3d3Active}>attivo: {cur}</span>}
      </div>
      {isActive && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 6 }}>
            Fa il D3 il <b>2° equipaggio del dopo mezzanotte</b> (esce dopo le 3). Controlla che non tocchi sempre ai soliti:
          </div>
          {d3people.length === 0 ? (
            <div style={S.helper}>Assegna prima il 2° equipaggio del dopo mezzanotte.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {d3people.map((pid) => {
                const nm = pById[pid]?.name || (typeof pid === "string" && pid.startsWith("ext:") ? pid.slice(4).split("|")[0] : pid);
                const h = hotnessFrom(order, lastIdx, count, turno.id, pid);
                return (
                  <div key={pid} style={S.d3Row}>
                    <span style={{ flex: 1 }}>{nm}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>D3 fatti: <b>{count[pid] || 0}</b></span>
                    <HotDot h={h} count={count[pid] || 0} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- dettaglio assenti per il caposquadra (motivo + commento privato) ---------- */
function AbsentDetails({ turno, people, availability }) {
  const rows = useMemo(() => {
    const out = [];
    people.forEach((p) => {
      if (p.permesso) return;
      const a = availability[turno.id]?.[p.id];
      if (!a) return;
      const fullyAbsent = a.pre === "ASSENTE" && a.post === "ASSENTE";
      if (fullyAbsent) {
        const r = MOTIVI[a.reason] ? a.reason : "altro";
        out.push({ name: p.name, reason: r, note: a.note || "" });
      }
    });
    return out.sort((x, y) => x.name.localeCompare(y.name));
  }, [turno.id, people, availability]);

  if (rows.length === 0) return null;

  return (
    <div style={S.absDetailBox}>
      <div style={S.galleyTitle}>🙅 Assenti e motivi <span style={S.absDetailPriv}>(solo tu, non finisce nel PDF/WhatsApp)</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => (
          <div key={r.name} style={S.absDetailRow}>
            <span style={{ fontWeight: 600 }}>{r.name}</span>
            <span style={S.absDetailReason}>{MOTIVI[r.reason].icon} {MOTIVI[r.reason].label}</span>
            {r.note && <span style={S.absDetailNote}>“{r.note}”</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- editor cambusa (misto: propone il giro, avvisa se scegli chi l'ha fatta da poco) ---------- */
function GalleyEditor({ turno, turni, people, pById, availability, galley, saveGalley }) {
  const cur = galley[turno.id] || [];

  // presenti a questo turno (chi ha dato disponibilità, permessi inclusi se scendono)
  const present = useMemo(() => people.filter((p) => {
    const a = availability[turno.id]?.[p.id];
    return a && (a.pre === "ENTRAMBE" || a.post === "ENTRAMBE");
  }), [people, availability, turno.id]);

  // statistiche del giro (conta tutti i turni)
  const { order, count, lastIdx } = useMemo(() => galleyCounts(turni, galley), [turni, galley]);
  const gapOf = (pid) => galleyGapForPerson(turni, galley, turno.id, pid);
  const hot = (pid) => hotnessFrom(order, lastIdx, count, turno.id, pid);
  const mark = (pid) => { const h = hot(pid); return h >= 0.66 ? "🟢" : h >= 0.33 ? "🟡" : "🔴"; };

  // ordina i presenti per "chi tocca": prima chi non l'ha mai fatta / gap maggiore, poi meno volte
  const ranked = useMemo(() => {
    return [...present].sort((a, b) => {
      const ga = gapOf(a.id), gb = gapOf(b.id);
      if (gb !== ga) return gb - ga; // gap maggiore prima
      const ca = count[a.id] || 0, cb = count[b.id] || 0;
      if (ca !== cb) return ca - cb; // meno volte prima
      return a.name.localeCompare(b.name);
    });
  }, [present, count, turni, galley, turno.id]);

  // i due suggeriti dal giro (esclusi quelli già scelti manualmente per non ripeterli)
  const suggeriti = ranked.filter((p) => !cur.includes(p.id)).slice(0, 2);

  const set = (idx, value) => {
    const next = JSON.parse(JSON.stringify(galley));
    const arr = next[turno.id] ? [...next[turno.id]] : [];
    arr[idx] = value || null;
    next[turno.id] = arr.filter((x, i) => i < 2);
    saveGalley(next);
  };
  const applicaSuggeriti = () => {
    const next = JSON.parse(JSON.stringify(galley));
    next[turno.id] = suggeriti.map((p) => p.id).slice(0, 2);
    saveGalley(next);
  };

  return (
    <div style={S.galleyBox}>
      <div style={S.galleyTitle}>🍝 Cambusa — chi porta da mangiare <span style={S.hotHint}>🟢 tocca a lui · 🔴 fatto da poco</span></div>

      <div style={S.galleyHint}>
        <span>
          {suggeriti.length > 0
            ? <>Tocca a: <b>{suggeriti.map((p) => p.name).join(" e ")}</b></>
            : "Nessun suggerimento disponibile"}
        </span>
        {suggeriti.length > 0 && (
          <button className="tap" style={S.galleySuggBtn} onClick={applicaSuggeriti}>Usa suggeriti</button>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[0, 1].map((i) => {
          const val = cur[i];
          const gap = val ? gapOf(val) : Infinity;
          const recent = val && gap !== Infinity && gap < GALLEY_RECENT;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <select
                style={{ ...S.slotSelect, minWidth: 160, ...(recent ? { borderColor: "var(--c-pre)" } : {}) }}
                value={val || ""}
                onChange={(e) => set(i, e.target.value)}
              >
                <option value="">— scegli —</option>
                {ranked.map((p) => {
                  const c = count[p.id] || 0;
                  return <option key={p.id} value={p.id}>{mark(p.id)} {p.name}{c ? ` (${c}×)` : " (mai)"}</option>;
                })}
              </select>
              {val && <HotDot h={hot(val)} count={count[val] || 0} />}
              {recent && (
                <span style={S.galleyWarn}>⚠️ l'ha portata da poco ({gap} {gap === 1 ? "turno" : "turni"} fa)</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- editor centralino (persone al telefono, diviso per metà) ---------- */
function CentralinoEditor({ turno, turni, people, pById, availability, assignments, saveAssign }) {
  // normalizza il dato (retrocompatibile col vecchio array)
  const raw = assignments[turno.id]?.centralino;
  const data = Array.isArray(raw)
    ? { pre: { people: raw, orario: "" }, post: { people: [], orario: "" } }
    : (raw || {});

  // hotness centralino su tutti i turni
  const { order, count, lastIdx } = useMemo(
    () => activityCounts(turni, assignments, extractCentralino),
    [turni, assignments]
  );
  const hot = (pid) => hotnessFrom(order, lastIdx, count, turno.id, pid);

  const presentIn = (half) =>
    people.filter((p) => {
      const a = availability[turno.id]?.[p.id];
      return a && (half === "pre" ? a.pre === "ENTRAMBE" : a.post === "ENTRAMBE");
    }).sort((a, b) => hot(b.id) - hot(a.id)); // più "caldi" in cima

  const mark = (pid) => { const h = hot(pid); return h >= 0.66 ? "🟢" : h >= 0.33 ? "🟡" : "🔴"; };

  const ensure = (obj) => {
    const next = JSON.parse(JSON.stringify(assignments));
    if (!next[turno.id]) next[turno.id] = { pre: [], post: [] };
    const c = next[turno.id].centralino;
    next[turno.id].centralino = Array.isArray(c)
      ? { pre: { people: c, orario: "" }, post: { people: [], orario: "" } }
      : (c || { pre: { people: [], orario: "" }, post: { people: [], orario: "" } });
    return next;
  };
  const setPerson = (half, idx, value) => {
    const next = ensure();
    const slot = next[turno.id].centralino[half] || { people: [], orario: "" };
    const arr = [...(slot.people || [])];
    arr[idx] = value || null;
    slot.people = arr.filter((x, i) => i < 3);
    next[turno.id].centralino[half] = slot;
    saveAssign(next);
  };
  const setOrario = (half, value) => {
    const next = ensure();
    const slot = next[turno.id].centralino[half] || { people: [], orario: "" };
    slot.orario = value;
    next[turno.id].centralino[half] = slot;
    saveAssign(next);
  };

  return (
    <div style={S.centralinoBox}>
      <div style={S.galleyTitle}>☎️ Centralino — chi risponde al telefono <span style={S.hotHint}>🟢 tocca a lui · 🔴 fatto da poco</span></div>
      {HALF_KEYS.map((half) => {
        const slot = data[half] || { people: [], orario: "" };
        const present = presentIn(half);
        return (
          <div key={half} style={{ marginTop: 10 }}>
            <div style={S.centralinoHalfRow}>
              <span style={S.centralinoHalfLabel}>{halfIcon(turno, half)} {halfLabel(turno, half)}</span>
              <input
                style={{ ...S.crewTimeInput, maxWidth: 150 }}
                value={slot.orario || ""}
                onChange={(e) => setOrario(half, e.target.value)}
                placeholder="Orario (es. 19:00-23:30)"
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[0, 1, 2].map((i) => {
                const val = slot.people?.[i] || "";
                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <select style={{ ...S.slotSelect, minWidth: 150 }} value={val} onChange={(e) => setPerson(half, i, e.target.value)}>
                      <option value="">— nessuno —</option>
                      {present.map((p) => (
                        <option key={p.id} value={p.id}>{mark(p.id)} {p.name} ({count[p.id] || 0}×)</option>
                      ))}
                    </select>
                    {val && <HotDot h={hot(val)} count={count[val] || 0} />}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ===========================================================================
   PERSONE — gestione squadra
   =========================================================================== */
function PersoneCapo({ people, savePeople }) {
  const [name, setName] = useState("");
  const [roles, setRoles] = useState({ autista: false, capo: false });

  const add = () => {
    if (!name.trim()) return;
    const r = ["soccorritore"];
    if (roles.autista) r.push("autista");
    if (roles.capo) r.push("capo");
    const id = "p" + Date.now();
    savePeople([...people, { id, name: name.trim(), roles: r }]);
    setName(""); setRoles({ autista: false, capo: false });
  };
  const toggleRole = (pid, role) => {
    savePeople(
      people.map((p) => {
        if (p.id !== pid) return p;
        const has = p.roles.includes(role);
        let r = has ? p.roles.filter((x) => x !== role) : [...p.roles, role];
        if (!r.includes("soccorritore")) r.push("soccorritore");
        return { ...p, roles: r };
      })
    );
  };
  const remove = (pid) => savePeople(people.filter((p) => p.id !== pid));
  const togglePermesso = (pid) =>
    savePeople(people.map((p) => (p.id === pid ? { ...p, permesso: !p.permesso } : p)));
  const toggleHide = (pid, slot) =>
    savePeople(people.map((p) => {
      if (p.id !== pid) return p;
      const hide = { ...(p.hide || {}) };
      hide[slot] = !hide[slot];
      return { ...p, hide };
    }));

  return (
    <>
      <h2 style={S.h2}>La squadra</h2>
      <p style={{ ...S.helper, marginTop: -8, marginBottom: 16 }}>
        Marca chi è autista e/o capo. Chi è <b>in permesso</b> non compila. Con i tag "no…" nascondi a quella persona gli slot che non le competono (es. chi fa solo prima di mezzanotte, o niente weekend).
      </p>
      <div style={S.addRow}>
        <input style={{ ...S.slotSelect, flex: 1, minWidth: 160 }} placeholder="Nome e cognome" value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <label style={S.checkPill}>
          <input type="checkbox" checked={roles.autista} onChange={(e) => setRoles((s) => ({ ...s, autista: e.target.checked }))} /> Autista
        </label>
        <label style={S.checkPill}>
          <input type="checkbox" checked={roles.capo} onChange={(e) => setRoles((s) => ({ ...s, capo: e.target.checked }))} /> Capo
        </label>
        <button className="tap" style={S.primaryBtn} onClick={add}>Aggiungi</button>
      </div>

      <div style={S.peopleGrid} className="stagger">
        {[...people].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
          <div key={p.id} style={{ ...S.personCard, ...(p.permesso ? { opacity: 0.6 } : {}) }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{p.name} {p.permesso && <span style={S.permTag}>🌴 in permesso</span>}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <RolePill on={p.roles.includes("autista")} onClick={() => toggleRole(p.id, "autista")}>🚑 Autista</RolePill>
                <RolePill on={p.roles.includes("capo")} onClick={() => toggleRole(p.id, "capo")}>⭐ Capo</RolePill>
                <RolePill on={p.permesso} onClick={() => togglePermesso(p.id)}>🌴 Permesso</RolePill>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <span style={S.hideLabel}>Non chiedere:</span>
                <RolePill on={p.hide?.pre} onClick={() => toggleHide(p.id, "pre")}>no prima mezz.</RolePill>
                <RolePill on={p.hide?.post} onClick={() => toggleHide(p.id, "post")}>no dopo mezz.</RolePill>
                <RolePill on={p.hide?.weekend} onClick={() => toggleHide(p.id, "weekend")}>no weekend</RolePill>
              </div>
            </div>
            <button style={S.removeBtn} onClick={() => remove(p.id)} title="Rimuovi">✕</button>
          </div>
        ))}
      </div>
    </>
  );
}

function RolePill({ on, onClick, children }) {
  return (
    <button onClick={onClick} style={{ ...S.rolePill, ...(on ? S.rolePillOn : {}) }}>{children}</button>
  );
}

/* ===========================================================================
   CLASSIFICHE
   =========================================================================== */
function Classifiche({ turni, people, assignments, galley, reports, availability }) {
  const stats = useMemo(() => {
    const cognomeOf = (p) => p.cognome || p.name.trim().split(" ")[0];
    const pById = Object.fromEntries(people.map((p) => [p.id, p]));
    // report fusi: base storica/manuale + auto-calcolo dai turni assegnati in app
    const auto = computeReportsFromApp(turni, assignments, pById, availability);
    const mergedR = mergeReports(reports || {}, auto);
    const byCognome = {};
    people.forEach((p) => {
      byCognome[cognomeOf(p)] = { name: p.name, id: p.id, presenze: 0, dopomezza: 0, centralino: 0, d3: 0, galley: 0 };
    });
    Object.values(mergedR).forEach((r) => {
      Object.entries(r.persone || {}).forEach(([cog, v]) => {
        if (!byCognome[cog]) byCognome[cog] = { name: cog, id: null, presenze: 0, dopomezza: 0, centralino: 0, d3: 0, galley: 0 };
        byCognome[cog].presenze += v.presenze || 0;
        byCognome[cog].dopomezza += (v.equi1 || 0) + (v.equi2 || 0);
        byCognome[cog].centralino += v.centralino || 0;
        byCognome[cog].d3 += v.d3 || 0;
      });
    });
    // cambusa dal "giro" (include storico histgalley: e turni live)
    const { count } = galleyCounts(turni, galley);
    Object.entries(count).forEach(([id, c]) => {
      const p = people.find((pp) => pp.id === id);
      if (p) { const k = cognomeOf(p); if (byCognome[k]) byCognome[k].galley = c; }
    });
    return Object.values(byCognome);
  }, [turni, people, assignments, reports, galley]);

  const ranks = [
    { key: "presenze", title: "🏆 Più presenze in totale", unit: "turni" },
    { key: "dopomezza", title: "🌃 Re del dopomezzanotte", unit: "volte" },
    { key: "centralino", title: "☎️ Re del centralino", unit: "volte" },
    { key: "d3", title: "🌗 Re del D3 (turno sfortunato)", unit: "D3" },
    { key: "galley", title: "🍝 Chef della cambusa", unit: "volte" },
  ];

  return (
    <>
      <h2 style={S.h2}>Classifiche</h2>
      <p style={S.helper}>Basate su tutto lo storico (report + turni assegnati). Per gioco — ma anche per tenere il carico equo e premiare chi fa le cose scomode.</p>
      <div style={S.rankGrid} className="stagger">
        {ranks.map((r) => {
          const sorted = [...stats].filter((s) => s[r.key] > 0).sort((a, b) => b[r.key] - a[r.key]).slice(0, 6);
          const max = sorted[0]?.[r.key] || 1;
          return (
            <div key={r.key} style={S.rankCard}>
              <div style={S.rankTitle}>{r.title}</div>
              {sorted.length === 0 && <div style={S.helper}>Ancora niente da mostrare.</div>}
              {sorted.map((s, i) => (
                <div key={s.name} style={S.rankRow}>
                  <span style={S.rankPos}>{["🥇", "🥈", "🥉"][i] || i + 1}</span>
                  <span style={{ flex: 1, fontSize: 14 }}>{s.name}</span>
                  <div style={S.rankBarWrap}>
                    <div style={{ ...S.rankBar, width: `${(s[r.key] / max) * 100}%` }} />
                  </div>
                  <span style={S.rankVal}>{s[r.key]} {r.unit}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ===========================================================================
   SEED gente (esempi modificabili nell'area Squadra)
   =========================================================================== */
const SEED_PEOPLE = [
  { id: "p1", name: "Marco Rossi", roles: ["soccorritore", "autista", "capo"] },
  { id: "p2", name: "Giulia Bianchi", roles: ["soccorritore", "capo"] },
  { id: "p3", name: "Luca Verdi", roles: ["soccorritore", "autista"] },
  { id: "p4", name: "Sara Colombo", roles: ["soccorritore"] },
  { id: "p5", name: "Andrea Ferrari", roles: ["soccorritore", "autista"] },
  { id: "p6", name: "Elena Russo", roles: ["soccorritore"] },
  { id: "p7", name: "Davide Romano", roles: ["soccorritore", "capo"] },
  { id: "p8", name: "Chiara Gallo", roles: ["soccorritore"] },
  { id: "p9", name: "Matteo Conti", roles: ["soccorritore", "autista", "capo"] },
  { id: "p10", name: "Francesca Greco", roles: ["soccorritore"] },
  { id: "p11", name: "Stefano Bruno", roles: ["soccorritore"] },
  { id: "p12", name: "Alice Marino", roles: ["soccorritore", "capo"] },
];

/* ===========================================================================
   STILE
   =========================================================================== */
function Style() {
  return (
    <style>{`
      :root{
        --bg:#0f1419; --panel:#161d26; --panel-2:#1c2530; --line:#27313d;
        --ink:#eef3f7; --ink-soft:#8ea1b3; 
        --cv:#1fae5a;            /* verde croceverde */
        --cv-deep:#15833f;
        --c-absent:#e2574c; --c-pre:#f0a830; --c-post:#5b9bf0; --c-both:#1fae5a;
        --r:14px;
        --ease:cubic-bezier(.22,.61,.36,1);
      }
      *{box-sizing:border-box}
      button{cursor:pointer;font-family:inherit}
      button:focus-visible, select:focus-visible, input:focus-visible{outline:2px solid var(--cv);outline-offset:2px}
      select, input{font-family:inherit}

      @media (prefers-reduced-motion: no-preference){
        /* comparsa del contenuto di ogni pagina/sezione */
        .page-anim{animation:pageIn .32s var(--ease) both}
        .acc-body{animation:fade .2s var(--ease)}

        /* comparsa "a cascata" delle card in una griglia */
        .stagger > *{animation:cardIn .34s var(--ease) both}
        .stagger > *:nth-child(1){animation-delay:.02s}
        .stagger > *:nth-child(2){animation-delay:.06s}
        .stagger > *:nth-child(3){animation-delay:.10s}
        .stagger > *:nth-child(4){animation-delay:.14s}
        .stagger > *:nth-child(5){animation-delay:.18s}
        .stagger > *:nth-child(6){animation-delay:.22s}
        .stagger > *:nth-child(7){animation-delay:.26s}
        .stagger > *:nth-child(8){animation-delay:.30s}
        .stagger > *:nth-child(n+9){animation-delay:.34s}
      }

      @keyframes fade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
      @keyframes pageIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
      @keyframes cardIn{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}

      /* micro-interazioni */
      .tap{transition:transform .12s var(--ease), background .18s var(--ease), color .18s var(--ease), border-color .18s var(--ease), box-shadow .18s var(--ease)}
      .tap:hover{transform:translateY(-1px)}
      .tap:active{transform:translateY(0) scale(.97)}

      .card-h{transition:transform .18s var(--ease), box-shadow .22s var(--ease), border-color .18s var(--ease)}
      .card-h:hover{transform:translateY(-2px); box-shadow:0 8px 22px rgba(0,0,0,.28); border-color:var(--cv)}

      /* barra animata sotto la tab attiva */
      .tabline{transition:background .2s var(--ease), color .2s var(--ease)}

      @media (prefers-reduced-motion: reduce){
        .page-anim,.stagger>*,.acc-body{animation:none !important}
        .tap,.card-h{transition:none !important}
      }
    `}</style>
  );
}

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const S = {
  shell: { background: "var(--bg)", color: "var(--ink)", minHeight: "100vh", fontFamily: FONT, fontSize: 15 },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "14px 20px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0,
    background: "rgba(15,20,25,.92)", backdropFilter: "blur(8px)", zIndex: 10, flexWrap: "wrap", gap: 12,
  },
  cross: {
    width: 38, height: 38, borderRadius: 10, background: "var(--cv)", color: "#fff",
    display: "grid", placeItems: "center", fontSize: 28, fontWeight: 800, lineHeight: 1,
  },
  brand: { fontWeight: 800, fontSize: 18, letterSpacing: -0.3 },
  brandSub: { fontSize: 12, color: "var(--ink-soft)" },
  tabs: { display: "flex", background: "var(--panel)", borderRadius: 12, padding: 4, gap: 4 },
  tab: { border: 0, background: "transparent", color: "var(--ink-soft)", padding: "8px 14px", borderRadius: 9, fontSize: 14, fontWeight: 600 },
  tabOn: { background: "var(--cv)", color: "#fff" },

  main: { maxWidth: 980, margin: "0 auto", padding: "26px 18px 60px" },
  footer: { textAlign: "center", color: "var(--ink-soft)", fontSize: 12, padding: "0 0 30px" },

  eyebrow: { fontSize: 12, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--cv)" },
  h2: { fontSize: 26, fontWeight: 800, letterSpacing: -0.5, margin: "6px 0 14px" },
  helper: { color: "var(--ink-soft)", fontSize: 14, lineHeight: 1.5 },

  bigCard: { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 18, padding: 24 },
  bigSelect: {
    width: "100%", padding: "16px 14px", fontSize: 18, borderRadius: 12,
    background: "var(--panel-2)", color: "var(--ink)", border: "1px solid var(--line)", marginTop: 8,
  },

  turniGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 },
  turnoCard: { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, padding: 16 },
  turnoCardDiurna: { background: "rgba(240,168,48,.06)", borderColor: "rgba(240,168,48,.4)" },
  diurnaTag: { fontSize: 12, fontWeight: 700, color: "var(--c-pre)", background: "rgba(240,168,48,.14)", padding: "3px 10px", borderRadius: 12 },
  turnoHead: { display: "flex", justifyContent: "space-between", marginBottom: 12 },
  turnoDate: { fontSize: 18, fontWeight: 800, textTransform: "capitalize" },
  turnoYear: { fontSize: 12, color: "var(--ink-soft)" },
  quickRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 },
  quickBtn: { padding: "9px 8px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--ink-soft)", fontSize: 13, fontWeight: 600 },
  quickBtnOn: { background: "var(--cv)", color: "#fff", borderColor: "var(--cv)" },
  halfRow: { display: "flex", gap: 10 },
  halfLabel: { fontSize: 12, color: "var(--ink-soft)", marginBottom: 5, fontWeight: 600 },
  segGroup: { display: "flex", gap: 4, background: "var(--panel-2)", padding: 4, borderRadius: 10 },
  segBtn: { flex: 1, padding: "8px 4px", borderRadius: 7, border: 0, background: "transparent", color: "var(--ink-soft)", fontSize: 13, fontWeight: 600 },
  segBtnOn: { color: "#fff" },
  weNote: { marginTop: 12, fontSize: 12, color: "var(--c-pre)", background: "rgba(240,168,48,.08)", padding: "8px 10px", borderRadius: 8 },

  subnav: { display: "flex", gap: 6, marginBottom: 22, background: "var(--panel)", padding: 5, borderRadius: 12, width: "fit-content", flexWrap: "wrap" },
  subnavBtn: { border: 0, background: "transparent", color: "var(--ink-soft)", padding: "9px 16px", borderRadius: 9, fontWeight: 600, fontSize: 14 },
  subnavOn: { background: "var(--panel-2)", color: "var(--ink)" },

  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 14, marginBottom: 18, flexWrap: "wrap" },
  primaryBtn: { background: "var(--cv)", color: "#fff", border: 0, padding: "12px 18px", borderRadius: 11, fontWeight: 700, fontSize: 14 },

  accordion: { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" },
  accHead: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 18px", background: "transparent", border: 0, color: "var(--ink)" },
  accDate: { fontSize: 17, fontWeight: 700, textTransform: "capitalize" },
  accBody: { padding: "4px 18px 20px", borderTop: "1px solid var(--line)" },
  badge: { fontSize: 12, fontWeight: 700, border: "1.5px solid", borderRadius: 20, padding: "3px 10px" },
  weNoteCapo: { fontSize: 13, color: "var(--c-pre)", background: "rgba(240,168,48,.08)", padding: "10px 12px", borderRadius: 10, margin: "14px 0" },

  halfTitle: { fontSize: 14, fontWeight: 700, margin: "14px 0 8px", color: "var(--ink)" },
  crewGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 },
  crewCard: { background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 },
  crewTitle: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--ink-soft)", marginBottom: 10 },
  slot: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  slotLabel: { fontSize: 13, color: "var(--ink-soft)", whiteSpace: "nowrap" },
  slotSelect: { background: "var(--panel)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 8px", fontSize: 13, maxWidth: 150 },
  warnDot: { background: "var(--c-pre)", color: "#000", width: 18, height: 18, borderRadius: 18, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12 },

  galleyBox: { background: "rgba(31,174,90,.06)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, marginTop: 6 },
  galleyTitle: { fontSize: 14, fontWeight: 700, marginBottom: 10 },
  galleyHint: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 13, color: "var(--ink-soft)", background: "rgba(31,174,90,.08)", borderRadius: 8, padding: "8px 10px", marginBottom: 10 },
  galleySuggBtn: { background: "var(--cv)", color: "#fff", border: 0, padding: "6px 12px", borderRadius: 8, fontWeight: 700, fontSize: 12 },
  galleyWarn: { fontSize: 11, color: "var(--c-pre)" },
  absDetailBox: { background: "rgba(226,87,76,.05)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, marginTop: 12 },
  absDetailPriv: { fontSize: 11, fontWeight: 400, color: "var(--ink-soft)" },
  absDetailRow: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", fontSize: 14 },
  absDetailReason: { fontSize: 12, color: "var(--ink-soft)", background: "var(--panel-2)", padding: "2px 8px", borderRadius: 10 },
  absDetailNote: { fontSize: 13, fontStyle: "italic", color: "var(--c-pre)" },

  addRow: { display: "flex", gap: 8, alignItems: "center", marginBottom: 20, flexWrap: "wrap" },
  checkPill: { display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--ink-soft)", background: "var(--panel)", padding: "8px 12px", borderRadius: 10, border: "1px solid var(--line)" },
  peopleGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 10 },
  personCard: { display: "flex", alignItems: "center", gap: 10, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 },
  rolePill: { fontSize: 12, padding: "4px 10px", borderRadius: 20, border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--ink-soft)" },
  rolePillOn: { background: "var(--cv)", color: "#fff", borderColor: "var(--cv)" },
  removeBtn: { background: "transparent", border: 0, color: "var(--ink-soft)", fontSize: 16 },

  rankGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14, marginTop: 10 },
  rankCard: { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, padding: 16 },
  rankTitle: { fontWeight: 700, marginBottom: 12 },
  rankRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 9 },
  rankPos: { width: 26, textAlign: "center", fontWeight: 700 },
  rankBarWrap: { flex: 1, height: 7, background: "var(--panel-2)", borderRadius: 6, overflow: "hidden", minWidth: 40 },
  rankBar: { height: "100%", background: "var(--cv)", borderRadius: 6 },
  rankVal: { fontSize: 12, color: "var(--ink-soft)", whiteSpace: "nowrap", minWidth: 56, textAlign: "right" },

  // --- nuove funzionalità ---
  alertBanner: {
    display: "flex", gap: 14, alignItems: "flex-start", marginTop: 22,
    background: "linear-gradient(135deg, rgba(226,87,76,.22), rgba(226,87,76,.10))",
    border: "1.5px solid var(--c-absent)", borderRadius: 16, padding: 18,
  },
  alertTurno: { background: "rgba(0,0,0,.22)", borderRadius: 10, padding: 12, marginBottom: 8 },
  subOfferBox: { marginTop: 22, background: "rgba(91,155,240,.08)", border: "1px solid var(--line)", borderRadius: 16, padding: 18 },
  doneTag: { fontSize: 11, fontWeight: 700, color: "var(--c-both)", background: "rgba(31,174,90,.16)", padding: "2px 8px", borderRadius: 12 },
  alertTag: { fontSize: 12, fontWeight: 700, color: "var(--c-absent)", background: "rgba(226,87,76,.14)", padding: "3px 10px", borderRadius: 12 },

  halfTitleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "14px 0 8px" },
  stepper: { display: "flex", alignItems: "center", gap: 8 },
  stepBtn: { width: 28, height: 28, borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--ink)", fontSize: 18, lineHeight: 1, display: "grid", placeItems: "center" },
  stepVal: { minWidth: 18, textAlign: "center", fontWeight: 700 },

  alertControlRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 6 },
  alertBtn: { border: "1.5px solid var(--c-absent)", background: "transparent", color: "var(--c-absent)", padding: "10px 16px", borderRadius: 11, fontWeight: 700, fontSize: 13 },
  alertBtnOn: { background: "var(--c-absent)", color: "#fff" },
  subsRecap: { background: "rgba(31,174,90,.06)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, marginTop: 12 },
  subRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 6, flexWrap: "wrap" },
  extTag: { fontSize: 11, color: "var(--c-post)", background: "rgba(91,155,240,.12)", padding: "2px 8px", borderRadius: 12 },

  extChip: { fontSize: 12, fontWeight: 600, color: "var(--c-post)", background: "rgba(91,155,240,.14)", border: "1px solid rgba(91,155,240,.4)", padding: "5px 9px", borderRadius: 8, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  extRemove: { background: "transparent", border: 0, color: "var(--ink-soft)", fontSize: 13 },

  // motivo assenza (compagni)
  reasonBox: { marginTop: 12, background: "rgba(226,87,76,.07)", border: "1px solid var(--line)", borderRadius: 10, padding: 12 },
  reasonRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  reasonBtn: { padding: "8px 6px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--ink-soft)", fontSize: 13, fontWeight: 600 },
  reasonBtnOn: { background: "var(--c-absent)", color: "#fff", borderColor: "var(--c-absent)" },

  // dimensione equipaggio
  crewHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 },
  crewNameInput: { flex: 1, minWidth: 0, background: "var(--panel)", color: "var(--cv)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 8px", fontSize: 14, fontWeight: 700 },
  crewTimesRow: { display: "flex", gap: 6, marginBottom: 10 },
  crewTimeInput: { flex: 1, minWidth: 0, background: "var(--panel)", color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 8px", fontSize: 12 },
  centralinoBox: { background: "rgba(91,155,240,.06)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, marginTop: 12 },
  centralinoHalfRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 },
  centralinoHalfLabel: { fontSize: 13, fontWeight: 600, color: "var(--ink)" },
  sheetTimes: { fontSize: 12, color: "var(--ink-soft)", marginBottom: 8 },
  sheetCentralino: { fontSize: 14, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" },
  sizeToggle: { display: "flex", gap: 3, background: "var(--panel)", borderRadius: 8, padding: 3 },
  sizeBtn: { width: 26, height: 24, borderRadius: 6, border: 0, background: "transparent", color: "var(--ink-soft)", fontSize: 13, fontWeight: 700 },
  sizeBtnOn: { background: "var(--cv)", color: "#fff" },

  // permesso
  permTag: { fontSize: 11, fontWeight: 700, color: "var(--c-post)", marginLeft: 6 },
  hideLabel: { fontSize: 11, color: "var(--ink-soft)", alignSelf: "center" },
  repTable: { borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 640 },
  repTh: { background: "var(--panel-2)", color: "var(--ink-soft)", fontWeight: 700, padding: "8px 10px", textAlign: "center", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" },
  repThHot: { background: "rgba(240,168,48,.18)", color: "var(--c-pre)" },
  repTd: { padding: "6px 8px", textAlign: "center", borderBottom: "1px solid var(--line)", color: "var(--ink)" },
  repTdHot: { background: "rgba(240,168,48,.06)" },
  repInput: { width: 52, background: "var(--panel)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 6px", textAlign: "center", fontSize: 13 },
  f3d3Box: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "rgba(155,120,240,.06)", border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginTop: 12 },
  f3d3Label: { fontSize: 13, fontWeight: 600, color: "var(--ink)" },
  f3d3Btn: { background: "var(--panel-2)", color: "var(--ink-soft)", border: "1px solid var(--line)", padding: "5px 10px", borderRadius: 8, fontSize: 12 },
  f3d3BtnOn: { background: "#7c5cf0", color: "#fff", borderColor: "#7c5cf0", fontWeight: 700 },
  f3d3Active: { fontSize: 11, color: "#9b78f0", fontWeight: 700 },
  hotHint: { fontSize: 10, fontWeight: 400, color: "var(--ink-soft)", marginLeft: 8 },
  d3Row: { display: "flex", alignItems: "center", gap: 10, fontSize: 13, background: "var(--panel-2)", borderRadius: 8, padding: "6px 10px" },

  // pubblicazione
  publishBox: { background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, marginTop: 12 },
  publishTitle: { fontSize: 14, fontWeight: 700, marginBottom: 8 },
  publishMsg: { width: "100%", background: "var(--panel)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", fontSize: 14, resize: "vertical", fontFamily: "inherit" },
  ghostBtn: { background: "transparent", color: "var(--ink)", border: "1px solid var(--line)", padding: "12px 16px", borderRadius: 11, fontWeight: 600, fontSize: 14 },
  noResp: { marginTop: 10, fontSize: 13, color: "var(--c-pre)", background: "rgba(240,168,48,.08)", padding: "8px 10px", borderRadius: 8 },

  // foglio (in-app)
  sheet: { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, padding: 18 },
  sheetTitle: { fontSize: 18, fontWeight: 800, marginBottom: 14, paddingBottom: 10, borderBottom: "2px solid var(--cv)" },
  sheetHalf: { fontSize: 14, fontWeight: 700, color: "var(--cv)", margin: "0 0 8px" },
  sheetCrews: { display: "flex", flexWrap: "wrap", gap: 10 },
  sheetCrew: { flex: 1, minWidth: 200, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 10, padding: 12 },
  sheetCrewN: { fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6 },
  sheetSlot: { display: "flex", gap: 8, fontSize: 13, padding: "2px 0" },
  sheetRole: { color: "var(--ink-soft)", minWidth: 84 },
  sheetExt: { color: "var(--c-post)", fontSize: 11 },
  absGroup: { minWidth: 130 },
  absGroupTitle: { fontWeight: 700, fontSize: 13, marginBottom: 4 },
  absName: { fontSize: 13, color: "var(--ink-soft)" },
  sheetMsg: { marginTop: 16, padding: "12px 14px", background: "rgba(31,174,90,.08)", borderLeft: "3px solid var(--cv)", borderRadius: 6, fontStyle: "italic", fontSize: 14 },

  notifBtn: { background: "var(--panel-2)", color: "var(--ink)", border: "1px solid var(--cv)", padding: "10px 16px", borderRadius: 11, fontWeight: 700, fontSize: 14 },
  notifBar: { fontSize: 13, color: "var(--ink-soft)", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 },
};
