import React, { useState, useEffect, useMemo, useCallback } from "react";

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
      setPeople(p);
      setAvailability(a);
      setAssignments(as);
      setGalley(g);
      setConfig(cfg);
      setAlerts(al);
      setPublished(pub);
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

  // numero equipaggi per metà di un turno (default EQUIPAGGI_PER_META).
  // Una diurna è un turno unico: di default 1 equipaggio sulla metà "pre", 0 sulla "post".
  const crewsFor = (turnoId, half) => {
    const explicit = config[turnoId]?.[half];
    if (explicit !== undefined) return explicit;
    const isDiurna = turnoId.endsWith(":diurna");
    if (isDiurna) return half === "pre" ? 1 : 0;
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
          />
        </CapoGate>
      )}
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
            style={{ ...S.tab, ...(tab === "compagni" ? S.tabOn : {}) }}
            onClick={() => setTab("compagni")}
          >
            Le mie disponibilità
          </button>
          <button
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
  const publishedTurni = useMemo(() => turni.filter((t) => published[t.id] && !isPast(t)), [turni, published]);

  // turni in cui a questa persona è stato chiesto un rimpiazzo:
  // alert attivo sul turno + la persona è ASSENTE su quel turno
  const myReplacementRequests = useMemo(() => {
    if (!personId) return [];
    return turni.filter((t) => {
      const al = alerts[t.id];
      if (!al?.active) return false;
      const a = availability[t.id]?.[personId];
      const isAbsent = !a || (a.pre === "ASSENTE" && a.post === "ASSENTE");
      return isAbsent;
    });
  }, [personId, turni, alerts, availability]);

  const saveMySub = (turnoId, field, value) => {
    const next = JSON.parse(JSON.stringify(alerts));
    if (!next[turnoId]) next[turnoId] = { active: true, resolved: {} };
    if (!next[turnoId].resolved) next[turnoId].resolved = {};
    const cur = next[turnoId].resolved[personId] || { sub: "", role: "soccorritore", squad: "" };
    cur[field] = value;
    next[turnoId].resolved[personId] = cur;
    saveAlerts(next);
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
          {myReplacementRequests.length > 0 && (
            <div style={S.alertBanner}>
              <div style={{ fontSize: 22 }}>🔴</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
                  Devi cercare un rimpiazzo!
                </div>
                <p style={{ ...S.helper, color: "#ffd9d4", margin: "0 0 12px" }}>
                  Per {myReplacementRequests.length === 1 ? "questo turno siamo scoperti" : "questi turni siamo scoperti"} e tu hai dato indisponibilità. Trova qualcuno di un'altra squadra che ti sostituisca e segna qui chi hai trovato.
                </p>
                {myReplacementRequests.map((t) => {
                  const r = alerts[t.id]?.resolved?.[personId] || { sub: "", role: "soccorritore", squad: "" };
                  const done = r.sub && r.sub.trim();
                  return (
                    <div key={t.id} style={S.alertTurno}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <b style={{ textTransform: "capitalize" }}>{t.label}</b>
                        {done && <span style={S.doneTag}>✓ rimpiazzo trovato</span>}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input
                          style={{ ...S.slotSelect, flex: 1, minWidth: 140, maxWidth: "none" }}
                          placeholder="Nome del sostituto"
                          value={r.sub}
                          onChange={(e) => saveMySub(t.id, "sub", e.target.value)}
                        />
                        <input
                          style={{ ...S.slotSelect, width: 130, maxWidth: "none" }}
                          placeholder="Sua squadra"
                          value={r.squad}
                          onChange={(e) => saveMySub(t.id, "squad", e.target.value)}
                        />
                        <select
                          style={{ ...S.slotSelect, maxWidth: "none" }}
                          value={r.role}
                          onChange={(e) => saveMySub(t.id, "role", e.target.value)}
                        >
                          <option value="soccorritore">Soccorritore</option>
                          <option value="autista">Autista</option>
                          <option value="capo">Capoequipaggio</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ ...S.eyebrow, marginTop: 28, marginLeft: 4 }}>Passo 2 · Ciao {me.name.split(" ")[0]}!</div>
          <NotificationButton personId={personId} />
          {me.permesso ? (
            <div style={{ ...S.bigCard, marginTop: 8, borderColor: "var(--c-post)" }}>
              <h2 style={{ ...S.h2, marginBottom: 6 }}>Sei in permesso 🌴</h2>
              <p style={S.helper}>
                Il caposquadra ti ha segnato in permesso per questo periodo, quindi non devi inserire disponibilità. Se è un errore, faglielo sapere.
              </p>
            </div>
          ) : (
          <>
          <h2 style={{ ...S.h2, marginLeft: 4, marginBottom: 4 }}>Segna i turni del mese</h2>
          <p style={{ ...S.helper, marginLeft: 4, marginTop: 0, marginBottom: 18 }}>
            Per ogni notte dicci se puoi <b>prima di mezzanotte</b>, <b>dopo</b>, tutto, o se sei assente. I bottoni veloci impostano tutto in un tocco.
          </p>

          <div style={S.turniGrid}>
            {futureTurni.map((t) => {
              const cur = availability[t.id]?.[personId] || { pre: "ASSENTE", post: "ASSENTE" };
              const isDiurna = t.kind === "diurna";
              const quickActive =
                cur.pre === "ENTRAMBE" && cur.post === "ENTRAMBE" ? "TUTTO" :
                cur.pre === "ENTRAMBE" && cur.post === "ASSENTE" ? "PRIMA" :
                cur.pre === "ASSENTE" && cur.post === "ENTRAMBE" ? "DOPO" :
                cur.pre === "ASSENTE" && cur.post === "ASSENTE" ? "ASSENTE" : null;
              return (
                <div key={t.id} style={{ ...S.turnoCard, ...(isDiurna ? S.turnoCardDiurna : {}) }}>
                  <div style={S.turnoHead}>
                    <div>
                      <div style={S.turnoDate}>{isDiurna ? "☀️ " : ""}{t.label}</div>
                      <div style={S.turnoYear}>
                        {isDiurna ? `diurna weekend · da ${t.parentLabel} notte` : `turno notturno · ${t.date.getFullYear()}`}
                      </div>
                    </div>
                  </div>

                  {isDiurna ? (
                    <>
                      <div style={S.halfRow}>
                        <HalfPicker
                          label="Diurna (di giorno)"
                          value={cur.pre}
                          onChange={(v) => setDispo(t.id, "pre", v, true)}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={S.quickRow}>
                        {[
                          ["TUTTO", "Tutto il turno"],
                          ["PRIMA", "Solo prima"],
                          ["DOPO", "Solo dopo"],
                          ["ASSENTE", "Assente"],
                        ].map(([mode, lbl]) => (
                          <button
                            key={mode}
                            onClick={() => setQuick(t.id, mode)}
                            style={{ ...S.quickBtn, ...(quickActive === mode ? S.quickBtnOn : {}) }}
                          >
                            {lbl}
                          </button>
                        ))}
                      </div>

                      <div style={S.halfRow}>
                        <HalfPicker label="Prima di mezzanotte" value={cur.pre} onChange={(v) => setDispo(t.id, "pre", v)} />
                        <HalfPicker label="Dopo mezzanotte" value={cur.post} onChange={(v) => setDispo(t.id, "post", v)} />
                      </div>
                    </>
                  )}

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
          </>
          )}
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
          ["archivio", "Archivio"],
        ].map(([k, l]) => (
          <button key={k} style={{ ...S.subnavBtn, ...(section === k ? S.subnavOn : {}) }} onClick={() => setSection(k)}>
            {l}
          </button>
        ))}
      </div>
      {section === "turni" && <TurniCapo {...props} />}
      {section === "persone" && <PersoneCapo {...props} />}
      {section === "classifiche" && <Classifiche {...props} />}
      {section === "archivio" && <ArchivioCapo {...props} />}
    </main>
  );
}

/* ---------- Archivio: turni passati in sola lettura ---------- */
function ArchivioCapo({ turni, people, availability, assignments, crewsFor }) {
  const pById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const past = useMemo(
    () => turni.filter((t) => isPast(t)).sort((a, b) => b.date - a.date), // più recenti in cima
    [turni]
  );
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
            <div key={t.id} style={S.accordion}>
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
  const cap = turno.label.charAt(0).toUpperCase() + turno.label.slice(1);

  const halfHtml = (h) => {
    if (!h.crews.length) return "";
    const crews = h.crews.map((c) => {
      const row = (role, s) =>
        `<tr><td class="role">${role}</td><td>${
          s ? esc(s.name) + (s.ext ? ` <span class="ext">· rimpiazzo${s.squad ? " (" + esc(s.squad) + ")" : ""}</span>` : "")
            : '<span class="empty">— scoperto —</span>'
        }</td></tr>`;
      const socc = c.soccorritori.map((s, i) =>
        row(c.soccorritori.length === 1 ? "Soccorritore" : "Soccorritore " + (i + 1), s)).join("");
      return `<div class="crew">
        <div class="crewn">Equipaggio ${c.n}</div>
        <table>${row("Autista", c.autista)}${row("Capo", c.capo)}${socc}</table>
      </div>`;
    }).join("");
    const icon = turno.kind === "diurna" ? "☀️" : (h.key === "pre" ? "🌙" : "🌃");
    return `<div class="half"><h3>${icon} ${esc(h.label)}</h3><div class="crews">${crews}</div></div>`;
  };

  const reasonHtml = MOTIVI_ORDER.map((k) => {
    if (!sheet.byReason[k].length) return "";
    return `<div class="absg"><div class="absgt">${MOTIVI[k].icon} ${MOTIVI[k].label}</div>${
      sheet.byReason[k].map((n) => `<div class="absn">${esc(n)}</div>`).join("")
    }</div>`;
  }).join("");
  const anyAbsent = MOTIVI_ORDER.some((k) => sheet.byReason[k].length);

  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
  <title>Equipaggi ${esc(cap)}</title>
  <style>
    @page { margin: 18mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif; color:#16202b; margin:0; }
    .top { display:flex; align-items:center; gap:12px; border-bottom:3px solid #1fae5a; padding-bottom:12px; margin-bottom:18px; }
    .cross { width:40px; height:40px; border-radius:9px; background:#1fae5a; color:#fff; display:flex; align-items:center; justify-content:center; font-size:30px; font-weight:800; }
    .brand { font-size:13px; color:#5b6b7a; letter-spacing:.5px; text-transform:uppercase; }
    h1 { font-size:24px; margin:2px 0 0; }
    .half { margin-bottom:18px; page-break-inside:avoid; }
    .half h3 { font-size:15px; margin:0 0 8px; color:#15833f; }
    .crews { display:flex; flex-wrap:wrap; gap:12px; }
    .crew { border:1px solid #d8e0e8; border-radius:10px; padding:10px 12px; min-width:220px; flex:1; }
    .crewn { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#7c8a98; margin-bottom:6px; font-weight:700; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    td { padding:3px 0; vertical-align:top; }
    td.role { color:#7c8a98; width:90px; white-space:nowrap; }
    .ext { color:#3a7bd0; font-size:11px; }
    .empty { color:#d6453a; }
    .absent { margin-top:6px; page-break-inside:avoid; }
    .absent h3 { font-size:15px; color:#15833f; margin:0 0 8px; }
    .absrow { display:flex; flex-wrap:wrap; gap:18px; }
    .absg { min-width:150px; }
    .absgt { font-weight:700; font-size:13px; margin-bottom:4px; }
    .absn { font-size:13px; color:#33424f; }
    .msg { margin-top:24px; padding:14px 16px; background:#eef8f1; border-left:4px solid #1fae5a; border-radius:6px; font-style:italic; font-size:14px; }
    .foot { margin-top:22px; font-size:11px; color:#9aa7b3; border-top:1px solid #e2e8ee; padding-top:8px; }
  </style></head><body>
    <div class="top">
      <div class="cross">+</div>
      <div><div class="brand">Croceverde APM · Milano</div><h1>Equipaggi — ${esc(cap)} ${turno.date.getFullYear()}</h1></div>
    </div>
    ${sheet.halves.map(halfHtml).join("")}
    ${anyAbsent ? `<div class="absent"><h3>Assenti</h3><div class="absrow">${reasonHtml}</div></div>` : ""}
    ${message && message.trim() ? `<div class="msg">${esc(message)}</div>` : ""}
    <div class="foot">Generato da Turni Squadra · ${new Date().toLocaleDateString("it-IT")}</div>
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
function autoGalley(turni, people, availability, existing) {
  // persone presenti per turno = chi ha disponibilità non-assente in almeno una metà
  const lastIndex = {}; // personId -> ultimo indice turno in cui ha portato
  const out = {};
  turni.forEach((t, idx) => {
    const present = people.filter((p) => {
      const a = availability[t.id]?.[p.id];
      return a && (a.pre === "ENTRAMBE" || a.post === "ENTRAMBE");
    });
    // ordina per "più lontano dall'ultima volta", poi meno volte fatto
    const counts = {};
    Object.values(out).flat().forEach((id) => (counts[id] = (counts[id] || 0) + 1));
    const ranked = present
      .map((p) => ({
        id: p.id,
        gap: lastIndex[p.id] === undefined ? 999 : idx - lastIndex[p.id],
        count: counts[p.id] || 0,
      }))
      .sort((a, b) => b.gap - a.gap || a.count - b.count);
    const chosen = ranked.slice(0, 2).map((r) => r.id);
    chosen.forEach((id) => (lastIndex[id] = idx));
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
        <button style={S.primaryBtn} onClick={runAuto}>⚡ Genera proposta automatica</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {turni.filter((t) => !isPast(t)).map((t) => {
          const isOpen = open === t.id;
          const a = assignments[t.id];
          const stats = coverageStats(t, a, crewsFor);
          const al = alerts[t.id];
          const subsFound = al ? Object.entries(al.resolved || {}).filter(([, r]) => r.sub && r.sub.trim()) : [];
          return (
            <div key={t.id} style={S.accordion}>
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

                  {(t.kind === "diurna" ? ["pre"] : ["pre", "post"]).map((half) => {
                    const nCrews = crewsFor(t.id, half);
                    const halfLabel = t.kind === "diurna"
                      ? "☀️ Diurna (di giorno)"
                      : (half === "pre" ? "🌙 Prima di mezzanotte" : "🌃 Dopo mezzanotte");
                    return (
                      <div key={half} style={{ marginBottom: 18 }}>
                        <div style={S.halfTitleRow}>
                          <div style={S.halfTitle}>{halfLabel}</div>
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
function PublishBlock({ turno, people, pById, availability, assignments, crewsFor, published, savePublished }) {
  const pub = published[turno.id];
  const [msg, setMsg] = useState(pub?.message || "");
  const sheet = useMemo(
    () => buildSheet(turno, people, assignments, availability, crewsFor, pById),
    [turno, people, assignments, availability, crewsFor, pById]
  );

  const buildTextSummary = () => {
    const lines = [`📋 EQUIPAGGI — ${turno.label} ${turno.date.getFullYear()}`, ""];
    sheet.halves.forEach((h) => {
      if (!h.crews.length) return;
      const icon = turno.kind === "diurna" ? "☀️" : (h.key === "pre" ? "🌙" : "🌃");
      lines.push(`${icon} ${h.label}`);
      h.crews.forEach((c) => {
        lines.push(`  Equipaggio ${c.n}:`);
        const line = (role, s) => lines.push(`   • ${role}: ${s ? s.name + (s.ext ? " (rimpiazzo)" : "") : "— scoperto —"}`);
        line("Autista", c.autista);
        line("Capo", c.capo);
        c.soccorritori.forEach((s, i) => line(c.soccorritori.length === 1 ? "Soccorritore" : `Soccorritore ${i + 1}`, s));
      });
      lines.push("");
    });
    const anyAbsent = MOTIVI_ORDER.some((k) => sheet.byReason[k].length);
    if (anyAbsent) {
      lines.push("Assenti:");
      MOTIVI_ORDER.forEach((k) => {
        if (sheet.byReason[k].length) lines.push(`  ${MOTIVI[k].label}: ${sheet.byReason[k].join(", ")}`);
      });
      lines.push("");
    }
    if (msg && msg.trim()) lines.push(msg.trim());
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
            <button style={S.primaryBtn} onClick={publish}>Aggiorna pubblicazione</button>
            <button style={S.ghostBtn} onClick={unpublish}>Ritira</button>
          </>
        ) : (
          <button style={S.primaryBtn} onClick={publish}>✅ Pubblica e invia su WhatsApp</button>
        )}
        <button style={S.ghostBtn} onClick={() => downloadSheetPDF(turno, sheet, msg)}>⬇️ Scarica PDF</button>
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
        <div style={S.crewTitle}>Equipaggio {crewIndex + 1}</div>
        <div style={S.sizeToggle}>
          <button style={{ ...S.sizeBtn, ...(size === 3 ? S.sizeBtnOn : {}) }} onClick={() => setSize(3)}>3</button>
          <button style={{ ...S.sizeBtn, ...(size === 4 ? S.sizeBtnOn : {}) }} onClick={() => setSize(4)}>4</button>
        </div>
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
  const isDiurna = turno.kind === "diurna";
  const halfDefs = isDiurna
    ? [{ key: "pre", label: "Diurna (di giorno)" }]
    : [{ key: "pre", label: "Prima di mezzanotte" }, { key: "post", label: "Dopo mezzanotte" }];
  const halves = halfDefs.map((h) => {
    const nCrews = crewsFor(turno.id, h.key);
    const crews = [];
    for (let i = 0; i < nCrews; i++) {
      const c = assignments[turno.id]?.[h.key]?.[i] || { autista: null, capo: null, soccorritori: [], size: 4 };
      const size = c.size || 4;
      const need = size - 2;
      crews.push({
        n: i + 1,
        autista: slotName(c.autista, pById),
        capo: slotName(c.capo, pById),
        soccorritori: Array.from({ length: need }).map((_, j) => slotName(c.soccorritori?.[j], pById)).filter(Boolean),
      });
    }
    return { ...h, crews };
  });

  // assenti raggruppati per motivo (solo chi NON è in permesso e ha messo "assente" su tutto)
  const byReason = { lavoro: [], studio: [], sanitaria: [], altro: [] };
  const notResponded = [];
  people.forEach((p) => {
    if (p.permesso) return; // i permessi non compaiono
    const a = availability[turno.id]?.[p.id];
    if (!a) { notResponded.push(p.name); return; }
    const fullyAbsent = a.pre === "ASSENTE" && a.post === "ASSENTE";
    if (fullyAbsent) {
      const r = MOTIVI[a.reason] ? a.reason : "altro";
      byReason[r].push(p.name);
    }
  });
  Object.keys(byReason).forEach((k) => byReason[k].sort((x, y) => x.localeCompare(y)));
  notResponded.sort((x, y) => x.localeCompare(y));

  return { halves, byReason, notResponded };
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
          <div style={S.sheetHalf}>{turno.kind === "diurna" ? "☀️" : (h.key === "pre" ? "🌙" : "🌃")} {h.label}</div>
          <div style={S.sheetCrews}>
            {h.crews.length === 0 && <div style={S.helper}>Nessun equipaggio.</div>}
            {h.crews.map((c) => (
              <div key={c.n} style={S.sheetCrew}>
                <div style={S.sheetCrewN}>Equipaggio {c.n}</div>
                {renderSlot("Autista", c.autista)}
                {renderSlot("Capo", c.capo)}
                {c.soccorritori.map((s, i) => renderSlot(c.soccorritori.length === 1 ? "Soccorritore" : `Soccorritore ${i + 1}`, s))}
              </div>
            ))}
          </div>
        </div>
      ))}

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

/* ---------- editor cambusa ---------- */
function GalleyEditor({ turno, people, pById, availability, galley, saveGalley }) {
  const cur = galley[turno.id] || [];
  const present = people.filter((p) => {
    const a = availability[turno.id]?.[p.id];
    return a && (a.pre === "ENTRAMBE" || a.post === "ENTRAMBE");
  });
  const set = (idx, value) => {
    const next = JSON.parse(JSON.stringify(galley));
    const arr = next[turno.id] ? [...next[turno.id]] : [];
    arr[idx] = value || null;
    next[turno.id] = arr.filter((x, i) => i < 2);
    saveGalley(next);
  };
  return (
    <div style={S.galleyBox}>
      <div style={S.galleyTitle}>🍝 Cambusa — chi porta da mangiare</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[0, 1].map((i) => (
          <select key={i} style={{ ...S.slotSelect, minWidth: 160 }} value={cur[i] || ""} onChange={(e) => set(i, e.target.value)}>
            <option value="">— scegli —</option>
            {present.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        ))}
      </div>
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

  return (
    <>
      <h2 style={S.h2}>La squadra</h2>
      <p style={{ ...S.helper, marginTop: -8, marginBottom: 16 }}>
        Marca chi è autista e/o capo. Chi è <b>in permesso</b> non deve compilare le disponibilità e viene escluso da conteggi e solleciti.
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
        <button style={S.primaryBtn} onClick={add}>Aggiungi</button>
      </div>

      <div style={S.peopleGrid}>
        {[...people].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
          <div key={p.id} style={{ ...S.personCard, ...(p.permesso ? { opacity: 0.6 } : {}) }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{p.name} {p.permesso && <span style={S.permTag}>🌴 in permesso</span>}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <RolePill on={p.roles.includes("autista")} onClick={() => toggleRole(p.id, "autista")}>🚑 Autista</RolePill>
                <RolePill on={p.roles.includes("capo")} onClick={() => toggleRole(p.id, "capo")}>⭐ Capo</RolePill>
                <RolePill on={p.permesso} onClick={() => togglePermesso(p.id)}>🌴 Permesso</RolePill>
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
function Classifiche({ turni, people, assignments, galley }) {
  const stats = useMemo(() => {
    const m = Object.fromEntries(people.map((p) => [p.id, { name: p.name, tot: 0, post: 0, pre: 0, galley: 0 }]));
    for (const t of turni) {
      const a = assignments[t.id];
      if (a) {
        for (const half of ["pre", "post"]) {
          (a[half] || []).forEach((c) => {
            const ids = [c.autista, c.capo, ...(c.soccorritori || [])].filter(Boolean);
            ids.forEach((id) => {
              if (!m[id]) return;
              m[id].tot++;
              if (half === "post") m[id].post++; else m[id].pre++;
            });
          });
        }
      }
      (galley[t.id] || []).forEach((id) => m[id] && m[id].galley++);
    }
    return Object.values(m);
  }, [turni, people, assignments, galley]);

  const ranks = [
    { key: "tot", title: "🏆 Più turni in totale", unit: "turni" },
    { key: "post", title: "🌃 Re del dopomezzanotte", unit: "notti" },
    { key: "galley", title: "🍝 Chef della cambusa", unit: "volte" },
  ];

  return (
    <>
      <h2 style={S.h2}>Classifiche</h2>
      <p style={S.helper}>Aggiornate in automatico man mano che assegni gli equipaggi. Per gioco — ma anche per tenere il carico equo.</p>
      <div style={S.rankGrid}>
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
      }
      *{box-sizing:border-box}
      @media (prefers-reduced-motion: no-preference){
        .acc-body{animation:fade .18s ease}
      }
      @keyframes fade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
      button{cursor:pointer;font-family:inherit}
      button:focus-visible, select:focus-visible, input:focus-visible{outline:2px solid var(--cv);outline-offset:2px}
      select, input{font-family:inherit}
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
  crewHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sizeToggle: { display: "flex", gap: 3, background: "var(--panel)", borderRadius: 8, padding: 3 },
  sizeBtn: { width: 26, height: 24, borderRadius: 6, border: 0, background: "transparent", color: "var(--ink-soft)", fontSize: 13, fontWeight: 700 },
  sizeBtnOn: { background: "var(--cv)", color: "#fff" },

  // permesso
  permTag: { fontSize: 11, fontWeight: 700, color: "var(--c-post)", marginLeft: 6 },

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
