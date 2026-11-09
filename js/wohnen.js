// Bereich „Wohnen“: Angebote, Karte, Vergleich von Miete und Kauf.
import { STANDARD, bewerte, kostensatz } from "./vergleich.js";

const HH = "data/hamburg/";
const LAERM_WMS = "https://geodienste.hamburg.de/wms_strategische_laermkarten?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=strasse_tag&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}";
const LAERM_LEGENDE = [["#E9F4D0", "55–59"], ["#F4D5A7", "60–64"], ["#DA7C77", "65–69"], ["#9D518B", "70–74"], ["#7A527F", "ab 75"]];
const BLAU = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
const LAUT = 65; // ab hier: Niveau einer Hauptverkehrsstraße
const SPEICHER = "fz_annahmen";

const zahl = (n, d = 0) => (n == null || !isFinite(n) ? "–" : n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const eur = (n) => `${zahl(Math.round(n))} €`;
const tausend = (n) => (n == null || !isFinite(n) ? "–" : `${zahl(Math.round(n / 1000) * 1000)} €`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const median = (w) => { const s = w.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const URTEIL = { guenstig: "günstig", fair: "marktüblich", teuer: "teuer" };

function preisKurz(a) {
  if (a.typ === "miete") return eur(a.preis);
  return a.preis >= 1e6 ? `${zahl(a.preis / 1e6, 2)} Mio` : `${zahl(Math.round(a.preis / 1000))} T€`;
}

function draussen(a) {
  if (a.garten) return { text: "Garten", ok: true };
  if (a.terrasse) return { text: "Terrasse", ok: true };
  if (a.balkon) return { text: "Balkon", ok: true };
  if (a.balkon === false && a.terrasse === false && a.garten === false) return { text: "kein Balkon im Inserat", ok: false };
  return { text: "Balkon offen", ok: null };
}

function laermText(a) {
  if (a.laerm == null) return null;
  if (a.laerm === 0) return "unter 55 dB";
  return a.laerm >= 75 ? "ab 75 dB" : `${a.laerm}–${a.laerm + 4} dB`;
}

function linie(a) {
  return a.bahn.linien.slice(0, 2).join("/") || "Bahn";
}

function versatz(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [((h & 255) / 255 - 0.5) * 0.003, (((h >> 8) & 255) / 255 - 0.5) * 0.002];
}

// ------------------------------------------------------------------ Einstieg

export async function zeigeWohnen(wurzel, stand) {
  wurzel.innerHTML = `<div class="laden">Karte wird geladen …</div>`;
  const [stadtteile, profil, preise, schulen, bahn] = await Promise.all(
    ["stadtteile.geojson", "stadtteile_profil.json", "preise_stadtteile.json", "grundschulen.json", "schnellbahn.json"]
      .map((f) => fetch(HH + f).then((r) => r.json())),
  );

  const einst = stand.einstellungen;
  const zustand = { typ: "alle", draussen: true, garten: false, ruhig: false, sort: "neu", gewaehlt: null, faerbung: "faktor", annahmen: annahmenLaden() };
  const alle = Object.values(stand.angebote).filter((a) => a.aktiv && a.lat != null);

  wurzel.innerHTML = gerippe(stand, preise, profil);
  const el = (s) => wurzel.querySelector(s);
  const karte = baueKarte(el("#karte"), { stadtteile, profil, preise, schulen, bahn, einst, zustand, wurzel });

  function sichtbar() {
    const { typ, draussen: d, garten, ruhig } = zustand;
    return alle.filter((a) => {
      if (a.flaeche < einst.muss.flaeche || (a.zimmer ?? 99) < einst.muss.zimmer) return false;
      if (typ !== "alle" && a.typ !== typ) return false;
      const dr = draussen(a);
      if (d && dr.ok === false) return false;
      if (garten && !a.garten) return false;
      if (ruhig && (a.laerm ?? 0) >= LAUT) return false;
      return true;
    });
  }

  function zeichne() {
    const liste = sichtbar().map((a) => ({ a, b: bewerte(a, preise.werte, zustand.annahmen) }));
    const sortierer = {
      neu: (x, y) => (y.a.erstmals || "").localeCompare(x.a.erstmals || "") || x.b.qm - y.b.qm,
      preis: (x, y) => x.a.preis - y.a.preis,
      guenstig: (x, y) => (x.b.abw ?? 9) - (y.b.abw ?? 9),
    };
    liste.sort(sortierer[zustand.sort]);
    el("#anzahl").textContent = `${liste.length} von ${alle.length} Angeboten passen`;
    marktleiste(el("#markt"), liste);
    el("#liste").innerHTML = liste.length ? liste.map(({ a, b }) => kachel(a, b, zustand)).join("") : `<p class="leer">Keine Angebote mit diesen Filtern.</p>`;
    karte.setzePins(liste, (id) => waehle(id, true));
  }

  function waehle(id, vonKarte) {
    zustand.gewaehlt = zustand.gewaehlt === id ? null : id;
    wurzel.querySelectorAll(".kachel").forEach((k) => {
      const offen = k.dataset.id === zustand.gewaehlt;
      k.classList.toggle("offen", offen);
      k.querySelector(".kachel-kopf").setAttribute("aria-expanded", String(offen));
      k.querySelector(".kachel-detail").hidden = !offen;
      if (offen && vonKarte) k.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    karte.markiere(zustand.gewaehlt);
  }

  // Bedienung
  el("#liste").addEventListener("click", (e) => {
    const kopf = e.target.closest(".kachel-kopf");
    if (kopf) waehle(kopf.closest(".kachel").dataset.id, false);
  });
  wurzel.querySelectorAll("[data-typ]").forEach((b) => b.addEventListener("click", () => {
    zustand.typ = b.dataset.typ;
    wurzel.querySelectorAll("[data-typ]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    zeichne();
  }));
  wurzel.querySelectorAll("[data-schalter]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.schalter;
    zustand[k] = !zustand[k];
    b.setAttribute("aria-pressed", String(zustand[k]));
    zeichne();
  }));
  el("#sort").addEventListener("change", (e) => { zustand.sort = e.target.value; zeichne(); });

  annahmenDialog(el("#annahmen"), el("#annahmen-oeffnen"), zustand, () => { zeichne(); });
  zeichne();
}

// ------------------------------------------------------------------ Gerüst

function gerippe(stand, preise, profil) {
  const m = stand.einstellungen.muss;
  const stand_ = new Date(stand.aktualisiert).toLocaleDateString("de-DE");
  return `
  <div class="wohnen">
    <section class="spalte" aria-label="Angebote">
      <div class="markt" id="markt"></div>
      <div class="filter">
        <div class="seg" role="group" aria-label="Art des Angebots">
          <button data-typ="alle" aria-pressed="true">Alle</button>
          <button data-typ="miete" aria-pressed="false">Miete</button>
          <button data-typ="kauf" aria-pressed="false">Kauf</button>
        </div>
        <button class="chip" data-schalter="draussen" aria-pressed="true">Balkon oder Garten</button>
        <button class="chip" data-schalter="garten" aria-pressed="false">Nur Garten</button>
        <button class="chip" data-schalter="ruhig" aria-pressed="false">Keine Hauptstraße</button>
      </div>
      <div class="unterfilter">
        <span id="anzahl"></span>
        <label>Sortieren
          <select id="sort">
            <option value="neu">Neueste zuerst</option>
            <option value="guenstig">Günstig zum Stadtteil</option>
            <option value="preis">Preis aufsteigend</option>
          </select>
        </label>
      </div>
      <div class="hinweis">Ab ${m.flaeche} m² und ${m.zimmer} Zimmern · Stand ${stand_} · <button class="link" id="annahmen-oeffnen">Annahmen und Quellen</button></div>
      <div id="liste" class="liste"></div>
    </section>
    <section class="kartenfeld" aria-label="Karte">
      <div id="karte"></div>
    </section>
  </div>
  <dialog id="annahmen" class="dialog"></dialog>`;
}

function marktleiste(ziel, liste) {
  const m = (typ) => median(liste.filter((x) => x.a.typ === typ).map((x) => x.b.qm));
  const miete = m("miete"), kauf = m("kauf");
  const faktor = miete && kauf ? kauf / (miete * 12) : null;
  ziel.innerHTML = `
    <div class="wert"><span>Miete, Median</span><b>${zahl(miete, 2)} €</b><small>je m², kalt</small></div>
    <div class="wert"><span>Kauf, Median</span><b>${zahl(kauf)} €</b><small>je m²</small></div>
    <div class="wert"><span>Kaufpreisfaktor</span><b>${zahl(faktor, 1)}</b><small>Jahresmieten</small></div>`;
}

function kachel(a, b, z) {
  const dr = draussen(a);
  const titel = esc(a.strasse ? `${a.strasse.replace(/\s+\d.*$/, "")}` : a.art || "Angebot");
  const urteil = b.urteil
    ? `<span class="urteil ${b.urteil}">${b.abw > 0 ? "+" : "−"}${zahl(Math.abs(b.abw) * 100)} % · ${URTEIL[b.urteil]}</span>`
    : "";
  const lt = laermText(a);
  const merk = [`${zahl(a.flaeche, a.flaeche % 1 ? 1 : 0)} m²`, `${zahl(a.zimmer, a.zimmer % 1 ? 1 : 0)} Zi.`, `<span class="dr ${dr.ok === null ? "offen" : dr.ok ? "ja" : "nein"}">${dr.text}</span>`];
  if (a.baujahr) merk.push(`Bj. ${a.baujahr}`);
  const lage = [`${esc(linie(a))} ${esc(a.bahn.name)} ${a.bahn.min} Min`, `Grundschule ${a.schule.min} Min`];
  if (lt) lage.push(`<span class="${a.laerm >= LAUT ? "laut" : ""}">${lt}</span>`);
  const offen = z.gewaehlt === a.id;
  return `
  <article class="kachel ${offen ? "offen" : ""}" data-id="${esc(a.id)}">
    <button class="kachel-kopf" aria-expanded="${offen}">
      <div class="z1"><span class="art ${a.typ}">${a.typ === "miete" ? "Miete" : "Kauf"}</span><span class="ort">${esc(a.stadtteil || "Hamburg")}</span>${urteil}</div>
      <div class="z2"><b>${eur(a.preis)}</b><small>${a.typ === "miete" ? "kalt · " : ""}${zahl(b.qm, a.typ === "miete" ? 2 : 0)} €/m²</small></div>
      <div class="z3">${merk.join(" · ")}</div>
      <div class="z4">${lage.join(" · ")}</div>
      ${b.gegen ? `<div class="z5">${a.typ === "miete" ? "Entspricht Kaufpreis" : "Entspricht Miete"} <b>${b.gegen.art === "kauf" ? tausend(b.gegen.wert) : eur(b.gegen.wert)}</b></div>` : ""}
    </button>
    <div class="kachel-detail" ${offen ? "" : "hidden"}>${detail(a, b, titel)}</div>
  </article>`;
}

function detail(a, b, titel) {
  const g = b.gegen;
  const zeilen = [];
  if (g) {
    const f = g.art === "kauf" ? tausend : eur;
    const marke = g.art === "kauf" ? "Kaufpreis" : "Miete";
    zeilen.push(`<dt>${g.art === "kauf" ? "Entsprechender" : "Entsprechende"} ${marke}</dt><dd><b>${f(g.wert)}</b>${g.art === "miete" ? " kalt" : ""}</dd>`);
    zeilen.push(`<dt>Spanne (Wertzuwachs ±1 Punkt)</dt><dd>${f(g.spanne[0])} bis ${g.spanne[1] == null || !isFinite(g.spanne[1]) ? "offen" : f(g.spanne[1])}</dd>`);
    zeilen.push(`<dt>${marke} am Markt, gleiche Größe</dt><dd>${f(g.markt)}</dd>`);
  }
  if (b.rate) zeilen.push(`<dt>Monatsrate (Zins + 2 % Tilgung)</dt><dd>${eur(b.rate)}</dd>`);
  if (b.ref) zeilen.push(`<dt>Stadtteil-Schnitt ${esc(a.stadtteil)}</dt><dd>${zahl(a.typ === "miete" ? b.ref.miete : b.ref.kauf, a.typ === "miete" ? 2 : 0)} €/m²</dd>`);
  const fazit = !g ? "" : g.besser === "mieten" ? "Mieten ist hier günstiger als Kaufen." : g.besser === "kaufen" ? "Kaufen ist hier günstiger als Mieten." : "Kaufen und Mieten liegen hier gleichauf.";

  const fakten = [];
  if (a.etage) fakten.push(`Etage ${esc(a.etage)}`);
  if (a.frei_ab) fakten.push(`frei ab ${esc(a.frei_ab)}`);
  if (a.energie) fakten.push(`Energie ${esc(a.energie)}`);
  if (a.neubau) fakten.push("Neubau/Erstbezug");
  if (a.privat) fakten.push("privat");
  if (a.provisionsfrei) fakten.push("provisionsfrei");
  if (a.kapitalanlage) fakten.push("als Kapitalanlage inseriert, evtl. vermietet");
  const ungefaehr = a.lage === "adresse" || a.lage === "strasse" ? "" : `<p class="klein">Lage nur ungefähr bekannt (${a.lage === "plz" ? "PLZ" : "Stadtteil"}), Wege und Lärm entsprechend unsicher.</p>`;
  return `
    ${fazit ? `<p class="fazit">${fazit}</p>` : ""}
    <dl>${zeilen.join("")}</dl>
    ${ungefaehr}
    <p class="klein">${esc(titel)}${fakten.length ? " · " + fakten.join(" · ") : ""} · Grundschule: ${esc(a.schule.name)}</p>
    <a class="zum-inserat" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Zum Inserat bei ${esc(a.quelle)}</a>`;
}

// ------------------------------------------------------------------ Annahmen

function annahmenLaden() {
  try { return { ...STANDARD, ...JSON.parse(localStorage.getItem(SPEICHER) || "{}") }; } catch { return { ...STANDARD }; }
}

const REGLER = [
  ["zins", "Bauzins", 2, 7, 0.1, "%"], ["ek", "Eigenkapitalanteil", 0, 60, 5, "%"],
  ["ekRendite", "Rendite auf Eigenkapital (nach Steuer)", 0, 8, 0.5, "%"], ["wert", "Wertzuwachs pro Jahr", -1, 5, 0.25, "%"],
  ["halten", "Haltedauer", 5, 30, 1, "Jahre"], ["kosten", "Eigentümerkosten je m²/Jahr", 10, 60, 1, "€"],
];

function annahmenDialog(d, oeffner, zustand, nachAenderung) {
  const a = zustand.annahmen;
  const zeilen = REGLER.map(([k, t, min, max, s, e]) => `
    <label class="regler"><span>${t}</span><output data-v="${k}">${zahl(a[k], s < 1 ? (s < 0.5 ? 2 : 1) : 0)} ${e}</output>
      <input type="range" data-k="${k}" min="${min}" max="${max}" step="${s}" value="${a[k]}"></label>`).join("");
  d.innerHTML = `
    <form method="dialog" class="dlg">
      <div class="dlg-kopf"><h2>Annahmen und Quellen</h2><button class="x" aria-label="Schließen">×</button></div>
      <p class="satz">Jährlicher Kostensatz: <b id="satz"></b> des Kaufpreises, zuzüglich Eigentümerkosten. Kaufnebenkosten ${zahl(a.grest + a.notar + a.makler, 2)} % (Steuer ${zahl(a.grest, 1)}, Notar ${zahl(a.notar, 1)}, Makler ${zahl(a.makler, 2)}).</p>
      ${zeilen}
      <button type="button" class="link" id="zurueck">Auf Standard zurücksetzen</button>
      <h3>So wird gerechnet</h3>
      <p>Ein Kaufpreis „entspricht“ einer Miete, wenn beide im Jahr gleich viel kosten. Der Wertzuwachs ist der größte Hebel, deshalb steht bei jedem Angebot die Spanne für ±1 Prozentpunkt.</p>
      <p>„Teuer“ und „günstig“ heißen: mehr als 10 % über oder unter dem Stadtteil-Schnitt.</p>
      <h3>Grenzen der Vergleichswerte</h3>
      <p>Die Stadtteil-Schnitte stammen von immobilienpreise-2026.de (Stand Q3 2026). Die Seite legt ihre Methode nicht offen, und sie mittelt alle Größen und Baujahre, Neubau wirkt also rasch „teuer“. Mit jedem Monat Inseraten ersetzen wir sie schrittweise durch eigene Mediane.</p>
      <p class="klein">Lärm: Strategische Lärmkarte 2022, lauteste Klasse im Umkreis von 25 m · Stadtteile, Schulen, HVV, Statistik: Freie und Hansestadt Hamburg, Datenlizenz Deutschland · Karte: OpenStreetMap, OpenFreeMap · Bauzins: Dr. Klein (9.10.2026), Interhyp (10.9.2026).</p>
    </form>`;
  const satz = () => { d.querySelector("#satz").textContent = `${zahl(kostensatz(zustand.annahmen) * 100, 2)} %`; };
  satz();
  d.querySelectorAll("input[type=range]").forEach((r) => r.addEventListener("input", () => {
    const k = r.dataset.k;
    zustand.annahmen[k] = Number(r.value);
    const [, , , , s, e] = REGLER.find((x) => x[0] === k);
    d.querySelector(`[data-v=${k}]`).textContent = `${zahl(zustand.annahmen[k], s < 1 ? (s < 0.5 ? 2 : 1) : 0)} ${e}`;
    try { localStorage.setItem(SPEICHER, JSON.stringify(zustand.annahmen)); } catch { /* nur für diese Sitzung */ }
    satz();
    nachAenderung();
  }));
  d.querySelector("#zurueck").addEventListener("click", () => {
    Object.assign(zustand.annahmen, STANDARD);
    d.querySelectorAll("input[type=range]").forEach((r) => {
      r.value = zustand.annahmen[r.dataset.k];
      r.dispatchEvent(new Event("input"));
    });
  });
  oeffner.addEventListener("click", () => d.showModal());
}

// ------------------------------------------------------------------ Karte

const METRIK = {
  faktor: { titel: "Kaufpreisfaktor", einheit: "Jahresmieten", d: 1, wert: (p) => (p?.wohnung?.kauf && p?.wohnung?.miete ? p.wohnung.kauf / (p.wohnung.miete * 12) : null), hilfe: "dunkler: Kaufen im Verhältnis zur Miete teurer" },
  kauf: { titel: "Kaufpreis Wohnung", einheit: "€/m²", d: 0, wert: (p) => p?.wohnung?.kauf ?? null },
  miete: { titel: "Miete Wohnung", einheit: "€/m²", d: 1, wert: (p) => p?.wohnung?.miete ?? null },
  efh: { titel: "Vorstadt-Anteil", einheit: "%", d: 0, quelle: "profil", wert: (_, s) => s?.efh ?? null, hilfe: "Anteil der Wohnungen in Ein- und Zweifamilienhäusern" },
};

function brueche(werte, n) {
  const s = werte.filter((x) => x != null).sort((a, b) => a - b);
  return Array.from({ length: n - 1 }, (_, i) => s[Math.floor(((i + 1) / n) * s.length)]);
}

function baueKarte(behaelter, { stadtteile, profil, preise, schulen, bahn, einst, zustand, wurzel }) {
  const heimat = einst.heimat;
  const karte = new maplibregl.Map({
    container: behaelter, style: "https://tiles.openfreemap.org/styles/positron",
    center: [9.97, 53.585], zoom: 11, minZoom: 9.5, maxZoom: 17, attributionControl: { compact: true }, cooperativeGestures: false,
  });
  karte.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

  for (const f of stadtteile.features) {
    const n = f.properties.name;
    for (const [k, m] of Object.entries(METRIK)) {
      const w = m.wert(preise.werte[n], profil.werte[n]);
      if (w != null) f.properties[k] = w;
    }
  }

  const ebenen = document.createElement("details");
  ebenen.className = "ebenen";
  ebenen.open = !window.matchMedia("(max-width: 860px)").matches;
  ebenen.innerHTML = `
    <summary>Karte anpassen</summary>
    <div class="ebenen-inhalt">
    <label class="sel">Stadtteile einfärben
      <select id="faerbung">
        <option value="faktor">Kaufen oder Mieten (Faktor)</option>
        <option value="kauf">Kaufpreis Wohnung</option>
        <option value="miete">Miete Wohnung</option>
        <option value="efh">Vorstadt-Anteil</option>
        <option value="">aus</option>
      </select>
    </label>
    <label><input type="checkbox" id="e-laerm"> Straßenlärm</label>
    <label><input type="checkbox" id="e-bahn" checked> U- und S-Bahn</label>
    <label><input type="checkbox" id="e-schule"> Grundschulen</label>
    </div>`;
  behaelter.appendChild(ebenen);
  const legende = document.createElement("div");
  legende.className = "legende";
  behaelter.appendChild(legende);
  const tipp = document.createElement("div");
  tipp.className = "tipp"; tipp.hidden = true;
  behaelter.appendChild(tipp);
  const tafel = document.createElement("aside");
  tafel.className = "tafel"; tafel.hidden = true;
  behaelter.appendChild(tafel);

  let pins = new Map();
  let bereit = false;
  const aufgeschoben = [];

  function legendeZeichnen() {
    const m = METRIK[zustand.faerbung];
    let h = "";
    if (m) {
      const br = brueche(stadtteile.features.map((f) => f.properties[zustand.faerbung]).filter((x) => x != null), BLAU.length);
      h += `<div class="lg"><b>${m.titel}</b> <span>${m.einheit}</span><div class="skala">${BLAU.map((c) => `<i style="background:${c}"></i>`).join("")}</div><div class="skala-z"><span>${zahl(br[0], m.d)}</span><span>${zahl(br[br.length - 1], m.d)}</span></div>${m.hilfe ? `<small>${m.hilfe}</small>` : ""}</div>`;
    }
    if (document.getElementById("e-laerm").checked) {
      h += `<div class="lg"><b>Straßenlärm</b> <span>Lden, dB(A)</span><div class="zeilen">${LAERM_LEGENDE.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join("")}</div></div>`;
    }
    h += `<div class="lg zeilen preise"><span><i class="k guenstig"></i>günstig</span><span><i class="k fair"></i>marktüblich</span><span><i class="k teuer"></i>teuer</span></div><div class="lg zeilen"><span><i class="k voll"></i>Kauf</span><span><i class="k hohl"></i>Miete</span></div>`;
    legende.innerHTML = h;
  }

  function faerben() {
    const k = zustand.faerbung;
    if (!k) { karte.setLayoutProperty("st-flaeche", "visibility", "none"); legendeZeichnen(); return; }
    const br = brueche(stadtteile.features.map((f) => f.properties[k]), BLAU.length);
    const stufen = ["step", ["to-number", ["get", k], 0], BLAU[0]];
    br.forEach((b, i) => stufen.push(b, BLAU[i + 1]));
    karte.setPaintProperty("st-flaeche", "fill-color", ["case", ["has", k], stufen, "rgba(0,0,0,0)"]);
    karte.setLayoutProperty("st-flaeche", "visibility", "visible");
    legendeZeichnen();
  }

  function tafelZeigen(n) {
    const p = preise.werte[n], s = profil.werte[n], ph = preise.werte[heimat], sh = profil.werte[heimat];
    const fk = (x) => METRIK.faktor.wert(x);
    const zeile = (t, a, b, d = 0, e = "") => `<tr><th>${t}</th><td>${a == null ? "–" : zahl(a, d) + e}</td>${n === heimat ? "" : `<td>${b == null ? "–" : zahl(b, d) + e}</td>`}</tr>`;
    tafel.innerHTML = `
      <div class="tafel-kopf"><h3>${esc(n)}</h3><button aria-label="Schließen">×</button></div>
      <table>
        <thead><tr><td></td><th>${esc(n)}</th>${n === heimat ? "" : `<th>${esc(heimat)}</th>`}</tr></thead>
        <tbody>
          ${zeile("Kaufpreis €/m²", p?.wohnung?.kauf, ph?.wohnung?.kauf)}
          ${zeile("Miete €/m²", p?.wohnung?.miete, ph?.wohnung?.miete, 2)}
          ${zeile("Kaufpreisfaktor", fk(p), fk(ph), 1)}
          ${zeile("Vorstadt-Anteil", s?.efh, sh?.efh, 0, " %")}
          ${zeile("Einwohner je ha", s?.dichte, sh?.dichte)}
          ${zeile("Haushalte mit Kindern", s?.kinder_hh, sh?.kinder_hh, 0, " %")}
          ${zeile("Ø Wohnung m²", s?.whg_qm, sh?.whg_qm)}
          ${zeile("Grundschulen", s?.grundschulen, sh?.grundschulen)}
        </tbody>
      </table>
      <p class="klein">Statistik ${profil.jahr}, Preise ${esc(preise.stand)} (Angebotsdaten).</p>`;
    tafel.hidden = false;
    tafel.querySelector("button").addEventListener("click", () => { tafel.hidden = true; });
  }

  // Nicht auf „load“ warten: das kommt erst, wenn alle Kacheln da sind.
  karte.once("style.load", () => {
    const erste = karte.getStyle().layers.find((l) => l.type === "symbol")?.id;
    karte.addSource("stadtteile", { type: "geojson", data: stadtteile });
    karte.addLayer({ id: "st-flaeche", type: "fill", source: "stadtteile", paint: { "fill-opacity": 0.45 } }, erste);
    karte.addLayer({ id: "st-linie", type: "line", source: "stadtteile", paint: { "line-color": "#ffffff", "line-width": 1 } }, erste);
    karte.addLayer({ id: "st-heimat", type: "line", source: "stadtteile", filter: ["==", ["get", "name"], heimat], paint: { "line-color": "#173A5E", "line-width": 2.5 } });
    karte.addSource("laerm", { type: "raster", tiles: [LAERM_WMS], tileSize: 256, attribution: "Lärmkarte: FHH" });
    karte.addLayer({ id: "laerm", type: "raster", source: "laerm", layout: { visibility: "none" }, paint: { "raster-opacity": 0.65 } });
    karte.addSource("bahn", { type: "geojson", data: { type: "FeatureCollection", features: bahn.map((b) => ({ type: "Feature", geometry: { type: "Point", coordinates: [b.lon, b.lat] }, properties: { name: b.name, linien: b.linien.join(" ") } })) } });
    karte.addLayer({ id: "bahn", type: "circle", source: "bahn", minzoom: 10.5, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10.5, 2.5, 14, 5], "circle-color": "#ffffff", "circle-stroke-color": "#173A5E", "circle-stroke-width": 1.5 } });
    karte.addLayer({ id: "bahn-name", type: "symbol", source: "bahn", minzoom: 12.5, layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.0], "text-anchor": "top", "text-optional": true }, paint: { "text-color": "#173A5E", "text-halo-color": "#ffffff", "text-halo-width": 1.2 } });
    karte.addSource("schule", { type: "geojson", data: { type: "FeatureCollection", features: schulen.map((s) => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: { name: s.name, ganztag: s.ganztag || "" } })) } });
    karte.addLayer({ id: "schule", type: "circle", source: "schule", layout: { visibility: "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 7], "circle-color": "#D98A00", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.2 } });

    const umschalten = (cb, ids) => cb.addEventListener("change", () => { ids.forEach((i) => karte.setLayoutProperty(i, "visibility", cb.checked ? "visible" : "none")); legendeZeichnen(); });
    umschalten(ebenen.querySelector("#e-laerm"), ["laerm"]);
    umschalten(ebenen.querySelector("#e-bahn"), ["bahn", "bahn-name"]);
    umschalten(ebenen.querySelector("#e-schule"), ["schule"]);
    ebenen.querySelector("#faerbung").addEventListener("change", (e) => { zustand.faerbung = e.target.value; faerben(); });
    faerben();

    karte.on("click", "st-flaeche", (e) => { if (!e.originalEvent.target.closest(".pin")) tafelZeigen(e.features[0].properties.name); });
    const beiHover = (e, inhalt) => { tipp.hidden = false; tipp.textContent = inhalt; tipp.style.left = `${e.point.x + 12}px`; tipp.style.top = `${e.point.y + 12}px`; karte.getCanvas().style.cursor = "pointer"; };
    const weg = () => { tipp.hidden = true; karte.getCanvas().style.cursor = ""; };
    karte.on("mousemove", "st-flaeche", (e) => { const p = e.features[0].properties, m = METRIK[zustand.faerbung]; beiHover(e, m && p[zustand.faerbung] != null ? `${p.name}: ${zahl(Number(p[zustand.faerbung]), m.d)} ${m.einheit}` : p.name); });
    karte.on("mouseleave", "st-flaeche", weg);
    karte.on("mousemove", "bahn", (e) => { const p = e.features[0].properties; beiHover(e, `${p.name} ${p.linien}`); });
    karte.on("mousemove", "schule", (e) => { const p = e.features[0].properties; beiHover(e, `${p.name}${p.ganztag ? " · " + p.ganztag : ""}`); });
    karte.on("zoom", () => behaelter.classList.toggle("weit", karte.getZoom() < 11.2));
    behaelter.classList.toggle("weit", karte.getZoom() < 11.2);
    bereit = true;
    aufgeschoben.splice(0).forEach((f) => f());
  });

  function setzePins(liste, beiKlick) {
    if (!bereit) { aufgeschoben.push(() => setzePins(liste, beiKlick)); return; }
    pins.forEach((p) => p.marker.remove());
    pins = new Map();
    for (const { a, b } of liste) {
      const [dx, dy] = a.lage === "adresse" || a.lage === "strasse" ? [0, 0] : versatz(a.id);
      const knopf = document.createElement("button");
      knopf.className = `pin ${a.typ} ${b.urteil || "ohne"} ${a.lage === "adresse" || a.lage === "strasse" ? "" : "ungefaehr"}`;
      knopf.textContent = preisKurz(a);
      knopf.title = `${a.stadtteil}: ${eur(a.preis)}`;
      knopf.addEventListener("click", (e) => { e.stopPropagation(); beiKlick(a.id); });
      const marker = new maplibregl.Marker({ element: knopf, anchor: "center" }).setLngLat([a.lon + dx, a.lat + dy]).addTo(karte);
      pins.set(a.id, { marker, knopf, a });
    }
    markiere(zustand.gewaehlt);
  }

  function markiere(id) {
    pins.forEach(({ knopf }, k) => { knopf.classList.toggle("aktiv", k === id); if (k === id) knopf.style.zIndex = 5; else knopf.style.zIndex = ""; });
    const p = pins.get(id);
    if (p) karte.easeTo({ center: [p.a.lon, p.a.lat], zoom: Math.max(karte.getZoom(), 12.5), duration: 500 });
  }

  return { setzePins, markiere };
}
