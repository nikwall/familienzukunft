// Bereich „Vorschule“: Kitas und Vorschulklassen im Umkreis, auf Karte und als Liste.
import { esc, zahl } from "./format.js";
import { grundstil, gruenUndWasser } from "./kartenbasis.js";

const FRIST = new Date("2027-01-22T23:59:59+01:00");
const KLEIN = 40; // Kinder insgesamt
const KITA = "#2f7d5b";
const SCHULE = "#173a5e";
const breit = () => window.matchMedia("(min-width: 900px)").matches;

const ICON = {
  liste: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  karte: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.300"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

const GANZTAG = { offen: "Offene Ganztagsschule (GBS)", "GTS teilweise gebunden": "Teilweise gebundener Ganztag", "GTS voll gebunden": "Gebundener Ganztag" };
const km = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${zahl(m / 1000, 1)} km`);

function schwerpunkte(x) {
  const t = [];
  if (x.art === "kita") {
    if (x.traegerart) t.push(x.traegerart);
    t.push(...x.merkmale);
    if (x.integration) t.push("Integration");
  } else {
    if (x.ganztag) t.push(GANZTAG[x.ganztag] ?? x.ganztag);
    if (x.inklusion) t.push("Schwerpunktschule Inklusion");
    t.push(...x.merkmale);
  }
  return [...new Set(t)];
}

function zeile2(x) {
  if (x.art === "kita") {
    const t = [];
    if (x.kinder) t.push(`${zahl(x.kinder)} Kinder`);
    if (x.qm_kind) t.push(`${zahl(x.qm_kind, 1)} m²/Kind`);
    if (x.stunden) t.push(`bis ${x.stunden} Std.`);
    return t.join(" · ");
  }
  const t = [];
  if (x.zuege) t.push(`${esc(x.zuege)}-zügig`);
  if (x.schueler) t.push(`${zahl(x.schueler)} Kinder`);
  t.push(x.frei ? "Privatschule" : "staatlich");
  return t.join(" · ");
}

function gruppe(x) {
  if (x.art === "schule") return "Vorschulklasse etwa 19 bis 23 Kinder, nachmittags 12 bis 14 Kinder je Fachkraft";
  if (x.gruppe) return `etwa ${zahl(x.gruppe)} Kinder (laut Website)`;
  return "Nicht veröffentlicht. In Hamburger Kitas sind es meist 20 bis 21 Kinder";
}

function angebot(x) {
  if (x.art === "schule") {
    const t = ["8 bis 13 Uhr, Betreuung von 6 bis 18 Uhr möglich"];
    if (x.kernzeit) t.push(`${zahl(x.kernzeit)} % der Grundschulkinder bleiben nachmittags`);
    if (x.ferien) t.push(`${zahl(Math.round(parseFloat(x.ferien)))} % nutzen die Ferienbetreuung`);
    return t.join(". ");
  }
  const t = [`Elementar${x.krippe ? " und Krippe" : ""}${x.hort ? ", Hort" : ""}`];
  if (x.stunden) t.push(`bis ${x.stunden} Stunden am Tag`);
  if (x.vorschule_web) t.push("Vorschularbeit auf der Website erwähnt");
  return t.join(", ");
}

function kosten(x) {
  if (x.art === "schule") {
    if (x.frei) return esc(x.schulgeld);
    return "8 bis 13 Uhr frei. Früh, nachmittags und in den Ferien nach Einkommen 4 bis 204 € im Monat, Mittagessen extra";
  }
  if (x.privat) return "Privat, kein Kita-Gutschein möglich. Bei der Einrichtung erfragen";
  return "5 Stunden mit Mittagessen frei. Mehr nach Einkommen: 6 Std. 4–115 €, 8 Std. 11–191 €, 10 Std. 16–204 €, 12 Std. 22–204 € im Monat";
}

function kreis(mitte, radius) {
  const r = [];
  const lat = mitte.lat * Math.PI / 180;
  for (let i = 0; i <= 72; i++) {
    const w = (i / 72) * 2 * Math.PI;
    r.push([mitte.lon + ((radius * Math.cos(w)) / (111320 * Math.cos(lat))), mitte.lat + (radius * Math.sin(w)) / 110540]);
  }
  return { type: "Feature", geometry: { type: "LineString", coordinates: r }, properties: {} };
}

export async function zeigeVorschule(wurzel) {
  wurzel.innerHTML = `<div class="laden">Wird geladen …</div>`;
  const r = await fetch("data/hamburg/vorschule.json");
  if (!r.ok) throw new Error(`vorschule.json: ${r.status}`);
  const d = await r.json();
  const alle = [...d.schulen, ...d.kitas];
  const z = { art: "alle", weite: 3000, klein: false, profil: false, sort: "nah", offen: null, blatt: null, ansicht: "liste" };
  let karte = null;
  let karteLaedt = null;
  const tage = Math.ceil((FRIST - new Date()) / 864e5);

  wurzel.innerHTML = `
    <div class="vs" data-ansicht="liste">
      <section class="v-liste" aria-label="Kandidaten">
        <div class="frist${tage <= 30 ? " dringend" : ""}">
          ${tage >= 0 ? `<b>Noch ${tage} Tage</b> Anmeldung Vorschulklasse 2027/28 bis 22. Januar 2027, direkt an der Schule.` : "Die Anmeldefrist für die Vorschulklassen 2027/28 ist vorbei."}
        </div>
        <details class="vergleich">
          <summary>Kita oder Vorschulklasse? Die Unterschiede</summary>
          <table>
            <thead><tr><td></td><th>Kita</th><th>Vorschulklasse</th></tr></thead>
            <tbody>
              <tr><th>Gruppe</th><td>etwa 20–21 Kinder</td><td>etwa 19–23 Kinder</td></tr>
              <tr><th>Personal</th><td>eine Fachkraft für etwa 10 Kinder</td><td>eine Lehrkraft je Klasse, nachmittags eine Kraft für 12–14 Kinder</td></tr>
              <tr><th>Zeiten</th><td>wie im Kita-Gutschein</td><td>8–13 Uhr, Betreuung 6–18 Uhr möglich</td></tr>
              <tr><th>Kosten</th><td>5 Std. mit Essen frei, mehr nach Einkommen</td><td>8–13 Uhr frei, mehr und Essen nach Einkommen</td></tr>
              <tr><th>Ferien</th><td>max. 4 Wochen und 3 Tage zu, Urlaub flexibel</td><td>Ferienbetreuung kostet, Urlaub nur in den Schulferien</td></tr>
              <tr><th>Anmeldung</th><td>Kita-Gutschein verlängern</td><td>Nov. bis 22. Jan., danach Kita-Platz kündigen</td></tr>
            </tbody>
          </table>
          <p class="klein">Alle Hamburger Grundschulen bieten Vorschulklassen an. Anmelden lassen sich Kinder, die zwischen dem 2.7.2021 und dem 1.1.2023 geboren sind. Der Platz in der Vorschulklasse sichert keinen Platz in Klasse 1 derselben Schule. Einkommensgenau rechnet der <a href="https://serviceportal.hamburg.de/HamburgGateway/FVP/FV/BSF/Kita-Beitragsrechner/wfKitaBeitragsrechner.aspx" target="_blank" rel="noopener noreferrer">Kita-Beitragsrechner</a>.</p>
          <p class="klein">Quellen: Faltblatt „Kita oder Vorschulklasse?“ (Stand 10/2023), hamburg.de (Vorschule, Elternbeiträge).</p>
        </details>
        <div class="filter">
          <div class="seg" role="group" aria-label="Art">
            <button data-art="alle" aria-pressed="true">Alle</button>
            <button data-art="kita" aria-pressed="false">Kitas</button>
            <button data-art="schule" aria-pressed="false">Schulen</button>
          </div>
          <div class="seg" role="group" aria-label="Umkreis">
            <button data-weite="1000" aria-pressed="false">1 km</button>
            <button data-weite="2000" aria-pressed="false">2 km</button>
            <button data-weite="3000" aria-pressed="true">3 km</button>
          </div>
          <button class="chip" data-schalter="klein" aria-pressed="false">Klein</button>
          <button class="chip" data-schalter="profil" aria-pressed="false">Mit Profil</button>
        </div>
        <div class="unterfilter">
          <span id="anzahl"></span>
          <select id="sort" aria-label="Sortierung">
            <option value="nah">Nächste zuerst</option>
            <option value="klein">Kleinste zuerst</option>
            <option value="platz">Meiste m² je Kind</option>
          </select>
        </div>
        <div id="liste" class="liste"></div>
        <p class="m-grenzen">Kinderzahl, Fläche und Angebot: Geoportal Hamburg (Erhebung 1.3.2026), Träger und Website: Kita-Infosystem. Schwerpunkte und Gruppengrößen sind Stichworte von den Websites der Einrichtungen, also Selbstauskünfte. Fehlt etwas, stand dort nichts Eindeutiges. Laufzeit zu Fuß mit Kind, Luftlinie plus 30 %.</p>
      </section>
      <section class="v-karte" aria-label="Karte">
        <div id="vs-karte"></div>
        <div class="legende vs-legende"><div class="lg zeilen"><span><i class="k" style="background:${KITA}"></i>Kita</span><span><i class="k" style="background:${SCHULE}"></i>Schule (S)</span><span>Kreise: 1, 2 und 3 km</span></div></div>
        <div id="blatt" class="blatt" hidden></div>
      </section>
      <nav class="unten" aria-label="Ansicht">
        <button data-ansicht="liste" aria-current="true">${icon("liste")}<span>Liste</span></button>
        <button data-ansicht="karte" aria-current="false">${icon("karte")}<span>Karte</span></button>
      </nav>
    </div>`;

  const el = (s) => wurzel.querySelector(s);
  const root = el(".vs");

  function sichtbar() {
    return alle.filter((x) => {
      if (z.art !== "alle" && x.art !== z.art) return false;
      if (x.m > z.weite) return false;
      if (z.klein && !(x.art === "kita" && x.kinder && x.kinder <= KLEIN)) return false;
      if (z.profil && !schwerpunkte(x).length) return false;
      return true;
    });
  }

  const SORT = {
    nah: (a, b) => a.m - b.m,
    klein: (a, b) => (a.kinder ?? a.schueler ?? 1e9) - (b.kinder ?? b.schueler ?? 1e9),
    platz: (a, b) => (b.qm_kind ?? -1) - (a.qm_kind ?? -1),
  };

  function kachel(x) {
    const offen = z.offen === x.id || z.blatt === x.id;
    const s = schwerpunkte(x);
    return `
    <article class="kand ${x.art}" data-id="${esc(x.id)}">
      <button class="kand-kopf" aria-expanded="${offen}">
        <span class="kand-name">${x.art === "schule" ? '<i class="s-marke">S</i>' : ""}${esc(x.name)}</span>
        <span class="kand-weg">${x.min} Min</span>
        <span class="kand-z2">${zeile2(x)}</span>
        ${s.length ? `<span class="kand-z3">${esc(s.slice(0, 3).join(" · "))}</span>` : ""}
      </button>
      ${offen ? `<dl class="kand-detail">
        <dt>Gruppengröße</dt><dd>${esc(gruppe(x))}</dd>
        <dt>Schwerpunkt</dt><dd>${s.length ? esc(s.join(" · ")) : "Nichts Eindeutiges gefunden"}</dd>
        <dt>Angebot</dt><dd>${angebot(x)}</dd>
        <dt>Kosten</dt><dd>${kosten(x)}</dd>
        ${x.betrieblich ? "<dt>Hinweis</dt><dd>Betriebskita, Plätze oft nur für Beschäftigte</dd>" : ""}
        <dt>Adresse</dt><dd>${esc(x.adresse)}, ${esc(x.plz)} · ${km(x.m)} entfernt${x.traeger ? `<br>Träger: ${esc(x.traeger)}` : ""}</dd>
      </dl>
      <div class="kand-links">
        ${x.web ? `<a class="zum-inserat" href="${esc(x.web.startsWith("http") ? x.web : `https://${x.web}`)}" target="_blank" rel="noopener noreferrer">Website</a>` : ""}
        ${x.tel ? `<a class="zum-inserat" href="tel:${esc(String(x.tel).replace(/[^\d+]/g, ""))}">Anrufen</a>` : ""}
      </div>` : ""}
    </article>`;
  }

  function punkte(liste) {
    return { type: "FeatureCollection", features: liste.map((x) => ({ type: "Feature", id: alle.indexOf(x), geometry: { type: "Point", coordinates: [x.lon, x.lat] }, properties: { id: x.id, art: x.art, name: x.name } })) };
  }

  function zeichnen() {
    const liste = sichtbar().sort(SORT[z.sort]);
    const k = liste.filter((x) => x.art === "kita").length;
    el("#anzahl").textContent = `${k} Kitas, ${liste.length - k} Schulen`;
    el("#liste").innerHTML = liste.length ? liste.map(kachel).join("") : `<p class="leer">Nichts mit dieser Auswahl.</p>`;
    karte?.getSource("orte")?.setData(punkte(liste));
    blatt();
  }

  function blatt() {
    const b = el("#blatt");
    const x = z.blatt && alle.find((e) => e.id === z.blatt);
    b.hidden = !x;
    b.innerHTML = x ? `<button class="blatt-zu" aria-label="Schließen">×</button>${kachel(x)}` : "";
    karte?.getSource("gewaehlt")?.setData({ type: "FeatureCollection", features: x ? [{ type: "Feature", geometry: { type: "Point", coordinates: [x.lon, x.lat] }, properties: {} }] : [] });
  }

  function karteBauen() {
    if (karteLaedt) return karteLaedt;
    karteLaedt = new Promise((fertig) => {
      karte = new maplibregl.Map({
        container: el("#vs-karte"), style: "https://tiles.openfreemap.org/styles/positron",
        center: [d.mitte.lon, d.mitte.lat], zoom: 12.3, minZoom: 10, maxZoom: 17, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
      });
      karte.touchZoomRotate.disableRotation();
      karte.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      karte.once("style.load", () => {
        const erste = karte.getStyle().layers.find((l) => l.type === "symbol")?.id;
        grundstil(karte);
        gruenUndWasser(karte, erste);
        karte.addSource("radius", { type: "geojson", data: { type: "FeatureCollection", features: [1000, 2000, 3000].map((m) => kreis(d.mitte, m)) } });
        karte.addLayer({ id: "radius", type: "line", source: "radius", paint: { "line-color": "#5f6b7a", "line-width": 1.2, "line-dasharray": [3, 3] } });
        karte.addSource("gewaehlt", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        karte.addLayer({ id: "gewaehlt", type: "circle", source: "gewaehlt", paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#1d2430", "circle-stroke-width": 2.5 } });
        karte.addSource("orte", { type: "geojson", data: punkte(sichtbar()) });
        karte.addLayer({ id: "kita", type: "circle", source: "orte", filter: ["==", ["get", "art"], "kita"], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.5, 15, 7.5], "circle-color": KITA, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
        karte.addLayer({ id: "schule", type: "circle", source: "orte", filter: ["==", ["get", "art"], "schule"], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 7, 15, 11], "circle-color": SCHULE, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
        karte.addLayer({ id: "schule-s", type: "symbol", source: "orte", filter: ["==", ["get", "art"], "schule"], layout: { "text-field": "S", "text-font": ["Noto Sans Bold"], "text-size": 10, "text-allow-overlap": true }, paint: { "text-color": "#fff" } });
        karte.addLayer({ id: "ort-name", type: "symbol", source: "orte", minzoom: 14.5, layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true, "text-max-width": 9 }, paint: { "text-color": "#1d2430", "text-halo-color": "#fff", "text-halo-width": 1.3 } });
        karte.addSource("mitte", { type: "geojson", data: { type: "Feature", geometry: { type: "Point", coordinates: [d.mitte.lon, d.mitte.lat] }, properties: { name: d.mitte.name } } });
        karte.addLayer({ id: "mitte", type: "circle", source: "mitte", paint: { "circle-radius": 6, "circle-color": "#c8102e", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
        karte.addLayer({ id: "mitte-name", type: "symbol", source: "mitte", layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, -1.3], "text-anchor": "bottom" }, paint: { "text-color": "#c8102e", "text-halo-color": "#fff", "text-halo-width": 1.5 } });
        for (const ebene of ["kita", "schule"]) {
          karte.on("click", ebene, (e) => waehlen(e.features[0].properties.id));
          karte.on("mousemove", ebene, () => { karte.getCanvas().style.cursor = "pointer"; });
          karte.on("mouseleave", ebene, () => { karte.getCanvas().style.cursor = ""; });
        }
        fertig();
      });
    });
    return karteLaedt;
  }

  function waehlen(id) {
    if (breit()) {
      z.offen = id;
      zeichnen();
      [...wurzel.querySelectorAll("#liste .kand")].find((e) => e.dataset.id === id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    z.blatt = z.blatt === id ? null : id;
    blatt();
  }

  function ansicht(v) {
    z.ansicht = v;
    root.dataset.ansicht = v;
    wurzel.querySelectorAll(".unten [data-ansicht]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.ansicht === v)));
    if (v === "karte") karteBauen().then(() => karte?.resize());
    else { z.blatt = null; blatt(); }
    window.scrollTo(0, 0);
  }

  wurzel.addEventListener("click", (e) => {
    const t = e.target;
    const art = t.closest("[data-art]");
    if (art) {
      z.art = art.dataset.art;
      wurzel.querySelectorAll("[data-art]").forEach((x) => x.setAttribute("aria-pressed", String(x === art)));
      zeichnen();
      return;
    }
    const weite = t.closest("[data-weite]");
    if (weite) {
      z.weite = Number(weite.dataset.weite);
      wurzel.querySelectorAll("[data-weite]").forEach((x) => x.setAttribute("aria-pressed", String(x === weite)));
      zeichnen();
      return;
    }
    const sch = t.closest("[data-schalter]");
    if (sch) {
      const k = sch.dataset.schalter;
      z[k] = !z[k];
      sch.setAttribute("aria-pressed", String(z[k]));
      zeichnen();
      return;
    }
    const v = t.closest(".unten [data-ansicht]");
    if (v) { ansicht(v.dataset.ansicht); return; }
    if (t.closest(".blatt-zu")) { z.blatt = null; blatt(); return; }
    const kopf = t.closest(".kand-kopf");
    if (kopf && !kopf.closest(".blatt")) {
      const id = kopf.closest(".kand").dataset.id;
      z.offen = z.offen === id ? null : id;
      zeichnen();
    }
  });
  el("#sort").addEventListener("change", (e) => { z.sort = e.target.value; zeichnen(); });

  zeichnen();
  if (breit()) karteBauen();
  return () => { karte?.remove(); karte = null; };
}
