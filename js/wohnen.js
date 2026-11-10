// Bereich „Wohnen“, vom Handy her gedacht: Angebote, Karte, Markt.
import { STANDARD, bewerte, eichung, kostensatz } from "./vergleich.js";
import { einordnen } from "./einordnung.js";
import { baueKarte } from "./karte.js";
import { zeigeMarkt } from "./markt.js";
import { ladeReaktionen, loescheKommentar, schreibeKommentar, setzeLike } from "./reaktionen.js";
import { esc, eur, merken, tausend, zahl } from "./format.js";

const LAUT = 65; // ab hier: Niveau einer Hauptverkehrsstraße
const NEU_TAGE = 3;
const breit = () => window.matchMedia("(min-width: 900px)").matches;
const holeJson = (f) => fetch(f).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); });
const LAUFE = "https://api.github.com/repos/nikwall/vinifeli/actions/workflows/aktualisieren.yml/runs?per_page=1&status=success";

const ICON = {
  liste: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  karte: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.300"/>',
  markt: '<path d="M4 18l5.500-6 4 3.500L20 8"/><path d="M15 8h5v5"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const HERZ = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 20.500s-7.500-4.700-9.300-9.300C1.500 8 3.400 4.700 6.800 4.700c2.100 0 3.700 1.100 5.200 3 1.500-1.900 3.100-3 5.200-3 3.400 0 5.300 3.300 4.100 6.500-1.800 4.600-9.300 9.300-9.300 9.300z"/></svg>';

function draussen(a) {
  if (a.garten) return "Garten";
  if (a.terrasse) return "Terrasse";
  if (a.balkon) return "Balkon";
  if (a.balkon === false && a.terrasse === false && a.garten === false) return null;
  return "Balkon?";
}

function ohneDraussen(a) {
  return a.balkon === false && a.terrasse === false && a.garten === false;
}

function laermText(a) {
  if (a.laerm == null) return null;
  if (a.laerm === 0) return "unter 55 dB";
  return a.laerm >= 75 ? "ab 75 dB" : `${a.laerm}–${a.laerm + 4} dB`;
}

// Wann hat der Abruf zuletzt nach neuen Mails gesehen? Das steht nicht in den Daten,
// weil sonst jeder Lauf einen Commit erzeugen würde. Fehlt die Antwort, entfällt die Angabe.
async function letzterLauf() {
  try {
    const r = await fetch(LAUFE, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const t = (await r.json()).workflow_runs?.[0]?.updated_at;
    return t ? new Date(t) : null;
  } catch {
    return null;
  }
}

function wann(d) {
  const uhr = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const tag = (x) => x.toLocaleDateString("de-DE");
  const gestern = new Date(Date.now() - 864e5);
  if (tag(d) === tag(new Date())) return `heute, ${uhr}`;
  if (tag(d) === tag(gestern)) return `gestern, ${uhr}`;
  return `${d.toLocaleDateString("de-DE", { day: "numeric", month: "short" })}, ${uhr}`;
}

function vor(d) {
  const min = Math.max(1, Math.round((Date.now() - d) / 6e4));
  if (min < 60) return `vor ${min} Min`;
  const std = Math.round(min / 60);
  return std < 24 ? `vor ${std} Std` : `vor ${Math.round(std / 24)} Tagen`;
}

function standText(stand, geprueft) {
  if (!stand.letzte_mail) return { an: false, text: `Stand ${wann(new Date(stand.aktualisiert))} · einmalig erfasst` };
  const mail = new Date(stand.letzte_mail);
  const frisch = geprueft && Date.now() - geprueft < 3 * 36e5;
  return { an: !!frisch, text: `Letzte neue Daten: ${wann(mail)}${geprueft ? ` · geprüft ${vor(geprueft)}` : ""}` };
}

export async function zeigeWohnen(wurzel, stand) {
  wurzel.innerHTML = `<div class="laden">Wird geladen …</div>`;
  const staedte = await holeJson("data/staedte.json");
  const geprueft = letzterLauf();
  let abbau = null;
  async function oeffnen(id) {
    abbau?.();
    const stadt = staedte.find((s) => s.id === id) ?? staedte[0];
    merken.schreiben("fz_stadt", stadt.id);
    const huelle = document.createElement("div");
    wurzel.replaceChildren(huelle);
    abbau = await baueStadt(huelle, stand, stadt, staedte, oeffnen, geprueft);
  }
  await oeffnen(merken.lesen("fz_stadt", "hamburg"));
  return () => abbau?.();
}

async function baueStadt(wurzel, stand, stadt, staedte, stadtWechseln, geprueft) {
  wurzel.innerHTML = `<div class="laden">Wird geladen …</div>`;
  const json = (f) => holeJson(`data/${stadt.id}/${f}`);
  const [preise, gebiete] = await Promise.all([json("preise_stadtteile.json"), json("gebiete.json")]);
  const alleNamen = Object.keys(preise.werte);
  const mengeVon = (g) => new Set(g.stadtteile ?? alleNamen);
  const GEBIET_KEY = stadt.id === "hamburg" ? "fz_gebiet" : `fz_gebiet_${stadt.id}`;
  const gespeichert = merken.lesen(GEBIET_KEY, null);

  const z = {
    typ: "alle", garten: false, ruhig: false, gemerkt: false, sort: "beste", offen: null, blatt: null, ansicht: "liste",
    aktiv: gespeichert ? new Set(gespeichert) : mengeVon(gebiete.find((g) => g.id === stadt.standardGebiet)),
    name: merken.lesen("fz_name", ""),
    annahmen: { ...STANDARD, ...merken.lesen("fz_annahmen", {}), grest: stadt.grest },
  };
  let r = { likes: new Map(), kommentare: new Map(), verfuegbar: false };
  let karte = null;
  let karteLaedt = null;
  const einst = stand.einstellungen;
  // Bis zu diesem Tag gilt alles als Ausgangsbestand, nicht als neu (erste Lieferungen der Suchaufträge).
  const grundTag = stand.einstellungen.bestand_bis ?? Object.keys(stand.verlauf || {}).sort()[0];
  const alle = Object.values(stand.angebote).filter((a) => a.aktiv && a.ort === stadt.name && a.lat != null && a.flaeche >= einst.muss.flaeche && (a.zimmer ?? 99) >= einst.muss.zimmer && !ohneDraussen(a));
  const eich = eichung(alle, preise.werte);
  let bewertet = [];

  function neuBewerten() {
    bewertet = alle.map((a) => { const b = bewerte(a, preise.werte, z.annahmen, eich); return { a, b, o: einordnen(a, b, preise.ebene) }; });
  }

  wurzel.innerHTML = `
    <div class="wohnen" data-ansicht="liste">
      <div class="stadtwahl" role="group" aria-label="Stadt">
        ${staedte.map((s) => `<button data-stadt="${s.id}" aria-pressed="${s.id === stadt.id}">${esc(s.name)}</button>`).join("")}
      </div>
      <div class="gebiete" role="group" aria-label="Gebiet">
        ${gebiete.map((g) => `<button data-gebiet="${g.id}" aria-pressed="false" aria-label="${esc(g.titel)}"><span class="g-kurz">${esc(g.kurz)}</span><span class="g-lang">${esc(g.titel)}</span></button>`).join("")}
      </div>
      <section class="v-liste" aria-label="Angebote">
        <p id="datenstand" class="datenstand" role="status"></p>
        <div class="filter">
          <div class="seg" role="group" aria-label="Art">
            <button data-typ="alle" aria-pressed="true">Alle</button>
            <button data-typ="miete" aria-pressed="false">Miete</button>
            <button data-typ="kauf" aria-pressed="false">Kauf</button>
          </div>
          <button class="chip" data-schalter="gemerkt" aria-pressed="false" hidden>Gemerkt</button>
          <button class="chip" data-schalter="garten" aria-pressed="false">Garten</button>
          <button class="chip" data-schalter="ruhig" aria-pressed="false">Ruhig</button>
        </div>
        <div class="unterfilter">
          <span id="anzahl"></span>
          <select id="sort" aria-label="Sortierung">
            <option value="beste">Beste zuerst</option>
            <option value="neu">Neueste zuerst</option>
            <option value="preis">Preis aufsteigend</option>
          </select>
        </div>
        <div id="liste" class="liste"></div>
      </section>
      <section class="v-markt" aria-label="Markt"><div id="markt" class="markt"></div></section>
      <section class="v-karte" aria-label="Karte">
        <div id="karte"></div>
        <div id="kurz" class="kurz" role="status" hidden></div>
        <div id="blatt" class="blatt" hidden></div>
      </section>
      <nav class="unten" aria-label="Ansicht">
        <button data-ansicht="liste" aria-current="true">${icon("liste")}<span>Angebote</span></button>
        <button data-ansicht="karte" aria-current="false">${icon("karte")}<span>Karte</span></button>
        <button data-ansicht="markt" aria-current="false">${icon("markt")}<span>Markt</span></button>
      </nav>
    </div>
    <dialog id="annahmen" class="dialog"></dialog>
    <dialog id="namen" class="dialog klein">
      <form method="dialog" class="dlg">
        <h2>Wer bist du?</h2>
        <p class="satz">Der Name steht bei deinen Likes und Kommentaren. Dieses Gerät merkt ihn sich.</p>
        <input id="name-feld" maxlength="40" autocomplete="given-name" placeholder="Vorname">
        <div class="dlg-knoepfe"><button value="ab" class="link">Abbrechen</button><button value="ok" class="primaer">Speichern</button></div>
      </form>
    </dialog>`;

  const el = (s) => wurzel.querySelector(s);
  const root = el(".wohnen");

  // ---------------------------------------------------------------- Auswahl

  function gebietAktuell() {
    return gebiete.find((g) => { const m = mengeVon(g); return m.size === z.aktiv.size && [...m].every((n) => z.aktiv.has(n)); }) ?? null;
  }

  function sichtbar() {
    return bewertet.filter(({ a }) => {
      if (!z.aktiv.has(a.stadtteil)) return false;
      if (z.typ !== "alle" && a.typ !== z.typ) return false;
      if (z.garten && !a.garten) return false;
      if (z.ruhig && (a.laerm ?? 0) >= LAUT) return false;
      if (z.gemerkt && !r.likes.get(a.id)?.size) return false;
      return true;
    });
  }

  function sortiert() {
    const s = {
      beste: (x, y) => y.o.punkte - x.o.punkte,
      neu: (x, y) => (y.a.erstmals || "").localeCompare(x.a.erstmals || "") || y.o.punkte - x.o.punkte,
      preis: (x, y) => x.a.preis - y.a.preis,
    };
    return sichtbar().sort(s[z.sort]);
  }

  // ---------------------------------------------------------------- Kacheln

  function kachel(x) {
    const { a, b, o } = x;
    const liked = r.likes.get(a.id);
    const n = liked?.size ?? 0;
    const ich = !!(z.name && liked?.has(z.name));
    const nk = r.kommentare.get(a.id)?.length ?? 0;
    const offen = z.offen === a.id;
    const neu = a.erstmals > grundTag && (new Date() - new Date(a.erstmals)) / 864e5 <= NEU_TAGE;
    const dr = draussen(a);
    const merkmale = [esc(a.stadtteil || stadt.name), `${zahl(a.flaeche, a.flaeche % 1 ? 1 : 0)} m²`, `${zahl(a.zimmer, a.zimmer % 1 ? 1 : 0)} Zi.`];
    if (dr) merkmale.push(dr);
    const g = b.gegen;
    const bezug = g ? `entspricht ${g.art === "kauf" ? `Kauf ${tausend(g.wert)}` : `Miete ${eur(g.wert)}`}` : "";
    const abwRund = b.abw == null ? null : Math.round(b.abw * 100);
    const abw = abwRund == null ? "" : `<span class="abw ${b.urteil}">${abwRund > 0 ? "+" : abwRund < 0 ? "−" : "±"}${Math.abs(abwRund)} %</span>`;
    return `
    <article class="kachel ${b.urteil || ""} ${offen ? "offen" : ""}" data-id="${esc(a.id)}">
      <button class="kachel-kopf" aria-expanded="${offen}">
        <div class="z1"><b>${eur(a.preis)}</b><small>${a.typ === "miete" ? "kalt · " : ""}${zahl(b.qm, a.typ === "miete" ? 2 : 0)} €/m²</small>${abw}${neu ? '<span class="neu">Neu</span>' : ""}</div>
        <div class="z2">${merkmale.join(" · ")}</div>
        <div class="pro"><i aria-hidden="true">▲</i><span>${esc(o.staerke)}</span></div>
        <div class="contra"><i aria-hidden="true">▼</i><span>${esc(o.schwaeche)}</span></div>
        <div class="z5"><span>${bezug}</span>${nk ? `<span class="nk">${nk} ${nk === 1 ? "Kommentar" : "Kommentare"}</span>` : ""}</div>
      </button>
      ${r.verfuegbar ? `<button class="herz ${ich ? "an" : ""}" aria-pressed="${ich}" aria-label="Gefällt mir">${HERZ}<span>${n || ""}</span></button>` : ""}
      ${offen ? `<div class="kachel-detail">${detail(x)}</div>` : ""}
    </article>`;
  }

  function detail({ a, b, o }) {
    const g = b.gegen;
    const zeilen = [];
    if (g) {
      const f = g.art === "kauf" ? tausend : eur;
      const m = g.art === "kauf" ? "Kaufpreis" : "Miete";
      const [u, h] = g.spanne;
      zeilen.push(`<dt>Entsprechende${g.art === "kauf" ? "r" : ""} ${m}</dt><dd><b>${f(g.wert)}</b><small>${f(u)} bis ${h == null ? "offen" : f(h)}</small></dd>`);
      zeilen.push(`<dt>${m} am Markt, gleiche Größe</dt><dd>${f(g.markt)}</dd>`);
    }
    if (b.rate) zeilen.push(`<dt>Monatsrate</dt><dd>${eur(b.rate)}</dd>`);
    const fazit = !g ? "" : g.besser === "mieten" ? "Mieten ist hier günstiger als Kaufen." : g.besser === "kaufen" ? "Kaufen ist hier günstiger als Mieten." : "Kaufen und Mieten liegen gleichauf.";
    const weitere = [...o.plus.slice(1, 4).map((p) => `<li class="p">${esc(p.t)}</li>`), ...o.minus.slice(1, 3).map((p) => `<li class="m">${esc(p.t)}</li>`)];
    const fakten = [];
    if (a.bahn) fakten.push(`${esc(a.bahn.linien.slice(0, 2).join("/"))} ${esc(a.bahn.name)} ${a.bahn.min} Min`);
    if (a.schule) fakten.push(`${esc(a.schule.name)} ${a.schule.min} Min`);
    if (laermText(a)) fakten.push(laermText(a));
    if (a.etage) fakten.push(`Etage ${esc(a.etage)}`);
    if (a.baujahr) fakten.push(`Bj. ${esc(a.baujahr)}`);
    if (a.energie) fakten.push(`Energie ${esc(a.energie)}`);
    if (a.frei_ab) fakten.push(`frei ab ${esc(a.frei_ab)}`);
    return `
      ${fazit ? `<p class="fazit">${fazit}</p>` : ""}
      <dl>${zeilen.join("")}</dl>
      ${weitere.length ? `<ul class="weitere">${weitere.join("")}</ul>` : ""}
      <p class="klein">${fakten.join(" · ")}</p>
      ${a.url ? `<a class="zum-inserat" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Zum Inserat</a>` : ""}
      ${kommentare(a)}`;
  }

  function kommentare(a) {
    if (!r.verfuegbar) return `<p class="klein">Likes und Kommentare sind gerade nicht erreichbar.</p>`;
    const liste = r.kommentare.get(a.id) ?? [];
    const namen = [...(r.likes.get(a.id) ?? [])];
    return `
      <div class="kommentare">
        ${namen.length ? `<p class="klein">Gefällt ${namen.map(esc).join(" und ")}</p>` : ""}
        <ul>${liste.map((k) => `<li><b>${esc(k.name)}</b> ${esc(k.text)}<button class="k-weg" data-k="${Number(k.id)}" aria-label="Kommentar löschen">×</button></li>`).join("")}</ul>
        <form class="k-form"><input name="text" maxlength="1000" placeholder="Kommentar" autocomplete="off" enterkeyhint="send" aria-label="Kommentar"><button class="primaer">Senden</button></form>
      </div>`;
  }

  // ---------------------------------------------------------------- Zeichnen

  function gebieteZeichnen() {
    const g = gebietAktuell();
    wurzel.querySelectorAll("[data-gebiet]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.gebiet === g?.id)));
  }

  function listeZeichnen() {
    const liste = sortiert();
    el("#anzahl").textContent = `${liste.length} ${liste.length === 1 ? "Angebot" : "Angebote"}`;
    el("#liste").innerHTML = liste.length ? liste.map(kachel).join("") : `<p class="leer">Keine Angebote mit dieser Auswahl.</p>`;
    karte?.setzePins(liste, z.blatt ?? z.offen);
  }

  function blattZeichnen() {
    const b = el("#blatt");
    const x = z.blatt && bewertet.find((e) => e.a.id === z.blatt);
    b.hidden = !x;
    b.innerHTML = x ? `<button class="blatt-zu" aria-label="Schließen">×</button>${kachel(x)}` : "";
  }

  function marktZeichnen() {
    const g = gebietAktuell() ?? gebiete.find((x) => x.stadtteile === null);
    zeigeMarkt(el("#markt"), stand.verlauf, g);
  }

  function allesZeichnen() {
    gebieteZeichnen();
    listeZeichnen();
    blattZeichnen();
    if (z.ansicht === "markt" || breit()) marktZeichnen();
  }

  let kurzUhr;
  function kurz(text) {
    const k = el("#kurz");
    k.textContent = text;
    k.hidden = false;
    clearTimeout(kurzUhr);
    kurzUhr = setTimeout(() => { k.hidden = true; }, 2400);
  }

  async function karteSichern() {
    if (karteLaedt) return karteLaedt;
    karteLaedt = (async () => {
      const [stadtteile, bahn, luft] = await Promise.all([json("stadtteile.geojson"), json("schnellbahn.json"), json("luft.json")]);
      karte = baueKarte(el("#karte"), {
        stadt, stadtteile, preise, bahn, luft, melden: (t) => kurz(t),
        beiStadtteil(n) {
          if (z.aktiv.has(n)) z.aktiv.delete(n); else z.aktiv.add(n);
          merken.schreiben(GEBIET_KEY, [...z.aktiv]);
          karte.aktivSetzen(z.aktiv);
          allesZeichnen();
          const p = preise.werte[n]?.wohnung;
          kurz(`${n} ${z.aktiv.has(n) ? "an" : "aus"}${p ? ` · Kauf ${zahl(p.kauf)} · Miete ${zahl(p.miete, 2)} €/m²` : ""}`);
        },
        beiPin(id) {
          if (breit()) { offenSetzen(id, true); return; }
          z.blatt = z.blatt === id ? null : id;
          z.offen = null;
          blattZeichnen();
          karte.markiere(z.blatt);
        },
      });
      karte.aktivSetzen(z.aktiv);
      karte.hinpassen(z.aktiv);
      karte.setzePins(sortiert(), z.blatt ?? z.offen);
      kurz("Stadtteil antippen: an oder aus");
    })();
    return karteLaedt;
  }

  function ansichtWechseln(v) {
    z.ansicht = v;
    root.dataset.ansicht = v;
    wurzel.querySelectorAll(".unten [data-ansicht]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.ansicht === v)));
    if (v === "karte") karteSichern().then(() => karte?.groesse());
    if (v === "markt") marktZeichnen();
    if (v !== "karte") z.blatt = null, blattZeichnen();
    window.scrollTo(0, 0);
  }

  function offenSetzen(id, vonKarte) {
    z.offen = z.offen === id ? null : id;
    listeZeichnen();
    blattZeichnen();
    karte?.markiere(z.offen, !!vonKarte);
    const k = [...wurzel.querySelectorAll(`.kachel`)].find((e) => e.dataset.id === z.offen && !e.closest(".blatt"));
    if (k && z.ansicht !== "karte" || (k && breit())) k.scrollIntoView({ behavior: "smooth", block: vonKarte ? "center" : "nearest" });
  }

  // ---------------------------------------------------------------- Likes und Kommentare

  function nameSichern() {
    if (z.name) return Promise.resolve(z.name);
    const d = el("#namen");
    const feld = el("#name-feld");
    feld.value = "";
    d.showModal();
    return new Promise((fertig) => {
      d.addEventListener("close", () => {
        const name = d.returnValue === "ok" ? feld.value.trim().slice(0, 40) : "";
        if (name) { z.name = name; merken.schreiben("fz_name", name); }
        fertig(name || null);
      }, { once: true });
    });
  }

  async function herz(id) {
    const name = await nameSichern();
    if (!name) return;
    const menge = r.likes.get(id) ?? new Set();
    const an = !menge.has(name);
    if (an) menge.add(name); else menge.delete(name);
    r.likes.set(id, menge);
    allesZeichnen();
    try {
      await setzeLike(id, name, an);
    } catch (e) {
      console.error(e);
      if (an) menge.delete(name); else menge.add(name);
      allesZeichnen();
      kurz("Konnte nicht gespeichert werden");
    }
  }

  async function kommentieren(form) {
    const id = form.closest(".kachel").dataset.id;
    const feld = form.elements.text;
    const text = feld.value.trim();
    if (!text) return;
    const name = await nameSichern();
    if (!name) return;
    feld.disabled = true;
    try {
      const neu = await schreibeKommentar(id, name, text);
      r.kommentare.set(id, [...(r.kommentare.get(id) ?? []), neu]);
      allesZeichnen();
    } catch (e) {
      console.error(e);
      feld.disabled = false;
      kurz("Konnte nicht gespeichert werden");
    }
  }

  async function kommentarWeg(id, kid) {
    const vorher = r.kommentare.get(id) ?? [];
    r.kommentare.set(id, vorher.filter((k) => k.id !== kid));
    allesZeichnen();
    try {
      await loescheKommentar(kid);
    } catch (e) {
      console.error(e);
      r.kommentare.set(id, vorher);
      allesZeichnen();
      kurz("Konnte nicht gelöscht werden");
    }
  }

  // ---------------------------------------------------------------- Bedienung

  wurzel.addEventListener("click", (e) => {
    const ziel = e.target;
    const wahl = ziel.closest("[data-stadt]");
    if (wahl) { if (wahl.dataset.stadt !== stadt.id) stadtWechseln(wahl.dataset.stadt); return; }
    const gebiet = ziel.closest("[data-gebiet]");
    if (gebiet) {
      z.aktiv = mengeVon(gebiete.find((g) => g.id === gebiet.dataset.gebiet));
      merken.schreiben(GEBIET_KEY, [...z.aktiv]);
      z.blatt = null;
      allesZeichnen();
      if (karte) { karte.aktivSetzen(z.aktiv); karte.hinpassen(z.aktiv); }
      return;
    }
    const typ = ziel.closest("[data-typ]");
    if (typ) {
      z.typ = typ.dataset.typ;
      wurzel.querySelectorAll("[data-typ]").forEach((x) => x.setAttribute("aria-pressed", String(x === typ)));
      listeZeichnen();
      return;
    }
    const schalter = ziel.closest("[data-schalter]");
    if (schalter) {
      const k = schalter.dataset.schalter;
      z[k] = !z[k];
      schalter.setAttribute("aria-pressed", String(z[k]));
      listeZeichnen();
      return;
    }
    const ansicht = ziel.closest(".unten [data-ansicht]");
    if (ansicht) { ansichtWechseln(ansicht.dataset.ansicht); return; }
    if (ziel.closest(".blatt-zu")) { z.blatt = null; blattZeichnen(); karte?.markiere(null, false); return; }
    if (ziel.closest("#annahmen-oeffnen")) { el("#annahmen").showModal(); return; }
    const karteEl = ziel.closest(".kachel");
    if (!karteEl) return;
    const id = karteEl.dataset.id;
    const weg = ziel.closest(".k-weg");
    if (weg) { kommentarWeg(id, Number(weg.dataset.k)); return; }
    if (ziel.closest(".herz")) { herz(id); return; }
    if (ziel.closest(".kachel-kopf")) offenSetzen(id, false);
  });
  wurzel.addEventListener("submit", (e) => {
    const f = e.target.closest(".k-form");
    if (f) { e.preventDefault(); kommentieren(f); }
  });
  el("#sort").addEventListener("change", (e) => { z.sort = e.target.value; listeZeichnen(); });

  annahmenDialog(el("#annahmen"), z, eich, stadt, preise, () => { neuBewerten(); allesZeichnen(); });

  const zeigeStand = (g) => {
    const f = el("#datenstand");
    if (!f) return;
    const s = standText(stand, g);
    f.textContent = s.text;
    f.classList.toggle("an", s.an);
  };
  zeigeStand(null);
  geprueft.then(zeigeStand);

  neuBewerten();
  allesZeichnen();
  if (breit()) karteSichern();
  ladeReaktionen().then((x) => {
    r = x;
    el('[data-schalter="gemerkt"]').hidden = false;
    allesZeichnen();
  }).catch((e) => console.warn("Likes und Kommentare nicht erreichbar:", e.message));
  return () => { karte?.entfernen(); karte = null; };
}

// ------------------------------------------------------------------ Annahmen

const REGLER = [
  ["zins", "Bauzins", 2, 7, 0.1, "%"], ["ek", "Eigenkapitalanteil", 0, 60, 5, "%"],
  ["ekRendite", "Rendite auf Eigenkapital (nach Steuer)", 0, 8, 0.5, "%"], ["wert", "Wertzuwachs pro Jahr", -1, 5, 0.25, "%"],
  ["halten", "Haltedauer", 5, 30, 1, "Jahre"], ["kosten", "Eigentümerkosten je m²/Jahr", 10, 60, 1, "€"],
];
const stellen = (s) => (s < 1 ? (s < 0.5 ? 2 : 1) : 0);

function annahmenDialog(d, z, eich, stadt, preise, nachAenderung) {
  const a = z.annahmen;
  d.innerHTML = `
    <form method="dialog" class="dlg">
      <div class="dlg-kopf"><h2>Annahmen und Quellen</h2><button class="x" aria-label="Schließen">×</button></div>
      <p class="satz">Jährlicher Kostensatz: <b id="satz"></b> des Kaufpreises, dazu Eigentümerkosten.</p>
      ${REGLER.map(([k, t, min, max, s, e]) => `
        <label class="regler"><span>${t}</span><output data-v="${k}">${zahl(a[k], stellen(s))} ${e}</output>
          <input type="range" data-k="${k}" min="${min}" max="${max}" step="${s}" value="${a[k]}"></label>`).join("")}
      <button type="button" class="link" id="zurueck">Auf Standard zurücksetzen</button>
      <h3>So wird gerechnet</h3>
      <p>Ein Kaufpreis entspricht einer Miete, wenn beide im Jahr gleich viel kosten. Der Wertzuwachs ist der größte Hebel, deshalb steht bei jedem Inserat die Spanne für einen Punkt mehr oder weniger. Grunderwerbsteuer ${esc(stadt.name)}: ${zahl(stadt.grest, 1)} %.</p>
      <h3>Grenzen</h3>
      <p>${preise.ebene === "stadt" ? `Für ${esc(stadt.name)} nennt die Quelle nur einen Wert für die ganze Stadt, „teuer“ und „günstig“ beziehen sich hier also auf den Stadtschnitt. ` : ""}Die Vergleichswerte stammen von immobilienpreise-2026.de (2026). Die Seite legt ihre Methode nicht offen und mittelt über alle Größen und Baujahre. Ihr Niveau ist deshalb auf die beobachteten Inserate geeicht (Miete × ${zahl(eich.miete, 2)}, Kauf × ${zahl(eich.kauf, 2)}). „Teuer“ und „günstig“ heißen: mehr als 10 % über oder unter diesem Wert.</p>
      <p class="klein">${stadt.laerm === "hamburg" ? "Lärm: Strategische Lärmkarte 2022, lauteste Klasse im Umkreis von 25 m" : "Lärm: Europäische Umweltagentur, nur kartierte Hauptstraßen"} · Luft: NO₂-Modell 2024 des Umweltbundesamts (1 km), Messstationen 2025 · Karte: OpenStreetMap, OpenFreeMap · Bauzins: Dr. Klein (9.10.2026), Interhyp (10.9.2026).</p>
    </form>`;
  const satz = () => { d.querySelector("#satz").textContent = `${zahl(kostensatz(z.annahmen) * 100, 2)} %`; };
  satz();
  d.querySelectorAll("input[type=range]").forEach((r) => r.addEventListener("input", () => {
    const k = r.dataset.k;
    z.annahmen[k] = Number(r.value);
    const [, , , , s, e] = REGLER.find((x) => x[0] === k);
    d.querySelector(`[data-v=${k}]`).textContent = `${zahl(z.annahmen[k], stellen(s))} ${e}`;
    merken.schreiben("fz_annahmen", z.annahmen);
    satz();
    nachAenderung();
  }));
  d.querySelector("#zurueck").addEventListener("click", () => {
    Object.assign(z.annahmen, STANDARD, { grest: stadt.grest });
    d.querySelectorAll("input[type=range]").forEach((r) => { r.value = z.annahmen[r.dataset.k]; r.dispatchEvent(new Event("input")); });
  });
}
