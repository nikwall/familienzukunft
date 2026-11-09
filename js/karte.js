// Karte: Stadtteile zum An- und Ausschalten, Preise als Marken, Lärm, Bahn, Schulen.
import { esc, eur, zahl } from "./format.js";

const LAERM_WMS = "https://geodienste.hamburg.de/wms_strategische_laermkarten?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=strasse_tag&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}";
const LAERM_LEGENDE = [["#E9F4D0", "55–59"], ["#F4D5A7", "60–64"], ["#DA7C77", "65–69"], ["#9D518B", "70–74"], ["#7A527F", "ab 75"]];
const BLAU = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
const AN = "#256abf";
const AUS = "#8c9098";

const METRIK = {
  faktor: { titel: "Kaufpreisfaktor", einheit: "Jahresmieten", d: 1, wert: (p) => (p?.wohnung?.kauf && p?.wohnung?.miete ? p.wohnung.kauf / (p.wohnung.miete * 12) : null) },
  kauf: { titel: "Kaufpreis Wohnung", einheit: "€/m²", d: 0, wert: (p) => p?.wohnung?.kauf ?? null },
  miete: { titel: "Miete Wohnung", einheit: "€/m²", d: 1, wert: (p) => p?.wohnung?.miete ?? null },
};

function brueche(werte, n) {
  const s = werte.filter((x) => x != null).sort((a, b) => a - b);
  return Array.from({ length: n - 1 }, (_, i) => s[Math.floor(((i + 1) / n) * s.length)]);
}

function preisKurz(a) {
  if (a.typ === "miete") return eur(a.preis);
  return a.preis >= 1e6 ? `${zahl(a.preis / 1e6, 2)} Mio` : `${zahl(Math.round(a.preis / 1000))} T€`;
}

function versatz(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [((h & 255) / 255 - 0.5) * 0.003, (((h >> 8) & 255) / 255 - 0.5) * 0.002];
}

export function baueKarte(behaelter, { stadtteile, preise, schulen, bahn, heimat, beiStadtteil, beiPin }) {
  const karte = new maplibregl.Map({
    container: behaelter, style: "https://tiles.openfreemap.org/styles/positron",
    center: [9.97, 53.585], zoom: 11, minZoom: 9.5, maxZoom: 17, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
  });
  karte.touchZoomRotate.disableRotation();
  karte.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

  for (const f of stadtteile.features) {
    for (const [k, m] of Object.entries(METRIK)) {
      const w = m.wert(preise.werte[f.properties.name]);
      if (w != null) f.properties[k] = w;
    }
  }

  const ebenen = document.createElement("details");
  ebenen.className = "ebenen";
  ebenen.open = window.matchMedia("(min-width: 900px)").matches;
  ebenen.innerHTML = `
    <summary>Karte anpassen</summary>
    <div class="ebenen-inhalt">
      <label class="sel">Stadtteile färben nach
        <select id="faerbung">
          <option value="">nur an oder aus</option>
          <option value="faktor">Kaufen oder Mieten (Faktor)</option>
          <option value="kauf">Kaufpreis Wohnung</option>
          <option value="miete">Miete Wohnung</option>
        </select>
      </label>
      <label><input type="checkbox" id="e-laerm"> Straßenlärm</label>
      <label><input type="checkbox" id="e-bahn" checked> U- und S-Bahn</label>
      <label><input type="checkbox" id="e-schule"> Grundschulen</label>
      <div class="legende"></div>
    </div>`;
  behaelter.appendChild(ebenen);
  const legende = ebenen.querySelector(".legende");

  let faerbung = "";
  let aktivMenge = new Set();
  let pins = new Map();
  let bereit = false;
  const aufgeschoben = [];
  const nachher = (f) => (bereit ? f() : aufgeschoben.push(f));

  function legendeZeichnen() {
    const m = METRIK[faerbung];
    let h = "";
    if (m) {
      const br = brueche(stadtteile.features.map((f) => f.properties[faerbung]), BLAU.length);
      h += `<div class="lg"><b>${m.titel}</b> <span>${m.einheit}</span><div class="skala">${BLAU.map((c) => `<i style="background:${c}"></i>`).join("")}</div><div class="skala-z"><span>${zahl(br[0], m.d)}</span><span>${zahl(br[br.length - 1], m.d)}</span></div></div>`;
    }
    if (ebenen.querySelector("#e-laerm").checked) {
      h += `<div class="lg"><b>Straßenlärm</b> <span>dB(A)</span><div class="zeilen">${LAERM_LEGENDE.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join("")}</div></div>`;
    }
    h += `<div class="lg zeilen"><span><i class="k guenstig"></i>günstig</span><span><i class="k fair"></i>marktüblich</span><span><i class="k teuer"></i>teuer</span></div><div class="lg zeilen"><span><i class="k voll"></i>Kauf</span><span><i class="k hohl"></i>Miete</span></div>`;
    legende.innerHTML = h;
  }

  function faerben() {
    const an = ["boolean", ["feature-state", "an"], false];
    let farbeAn = AN;
    if (faerbung) {
      const br = brueche(stadtteile.features.map((f) => f.properties[faerbung]), BLAU.length);
      const stufen = ["step", ["to-number", ["get", faerbung], 0], BLAU[0]];
      br.forEach((b, i) => stufen.push(b, BLAU[i + 1]));
      farbeAn = ["case", ["has", faerbung], stufen, AN];
    }
    karte.setPaintProperty("st-flaeche", "fill-color", ["case", an, farbeAn, AUS]);
    karte.setPaintProperty("st-flaeche", "fill-opacity", ["case", an, faerbung ? 0.55 : 0.16, 0.32]);
    legendeZeichnen();
  }

  function aktivSetzen(menge) {
    aktivMenge = menge;
    nachher(() => {
      for (const f of stadtteile.features) karte.setFeatureState({ source: "stadtteile", id: f.id }, { an: aktivMenge.has(f.properties.name) });
    });
  }

  function hinpassen(menge) {
    nachher(() => {
      let w = 180, s = 90, o = -180, n = -90;
      for (const f of stadtteile.features) {
        if (!menge.has(f.properties.name)) continue;
        for (const poly of f.geometry.coordinates) for (const [x, y] of poly[0]) { w = Math.min(w, x); o = Math.max(o, x); s = Math.min(s, y); n = Math.max(n, y); }
      }
      if (w < o) karte.fitBounds([[w, s], [o, n]], { padding: 24, duration: 500, maxZoom: 13.6 });
    });
  }

  karte.once("style.load", () => {
    const erste = karte.getStyle().layers.find((l) => l.type === "symbol")?.id;
    karte.addSource("stadtteile", { type: "geojson", data: stadtteile });
    karte.addLayer({ id: "st-flaeche", type: "fill", source: "stadtteile", paint: { "fill-color": AUS, "fill-opacity": 0.32 } }, erste);
    karte.addLayer({ id: "st-linie", type: "line", source: "stadtteile", paint: { "line-color": "#ffffff", "line-width": 1 } }, erste);
    karte.addLayer({ id: "st-heimat", type: "line", source: "stadtteile", filter: ["==", ["get", "name"], heimat], paint: { "line-color": "#173A5E", "line-width": 2.5 } });
    karte.addSource("laerm", { type: "raster", tiles: [LAERM_WMS], tileSize: 256, attribution: "Lärmkarte: FHH" });
    karte.addLayer({ id: "laerm", type: "raster", source: "laerm", layout: { visibility: "none" }, paint: { "raster-opacity": 0.65 } });
    karte.addSource("bahn", { type: "geojson", data: { type: "FeatureCollection", features: bahn.map((b) => ({ type: "Feature", geometry: { type: "Point", coordinates: [b.lon, b.lat] }, properties: { name: b.name, linien: b.linien.join(" ") } })) } });
    karte.addLayer({ id: "bahn", type: "circle", source: "bahn", minzoom: 10.5, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10.5, 2.5, 14, 5], "circle-color": "#ffffff", "circle-stroke-color": "#173A5E", "circle-stroke-width": 1.5 } });
    karte.addLayer({ id: "bahn-name", type: "symbol", source: "bahn", minzoom: 12.5, layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.0], "text-anchor": "top", "text-optional": true }, paint: { "text-color": "#173A5E", "text-halo-color": "#ffffff", "text-halo-width": 1.2 } });
    karte.addSource("schule", { type: "geojson", data: { type: "FeatureCollection", features: schulen.map((s) => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: { name: s.name } })) } });
    karte.addLayer({ id: "schule", type: "circle", source: "schule", layout: { visibility: "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 7], "circle-color": "#D98A00", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.2 } });

    const umschalten = (cb, ids) => cb.addEventListener("change", () => { ids.forEach((i) => karte.setLayoutProperty(i, "visibility", cb.checked ? "visible" : "none")); legendeZeichnen(); });
    umschalten(ebenen.querySelector("#e-laerm"), ["laerm"]);
    umschalten(ebenen.querySelector("#e-bahn"), ["bahn", "bahn-name"]);
    umschalten(ebenen.querySelector("#e-schule"), ["schule"]);
    ebenen.querySelector("#faerbung").addEventListener("change", (e) => { faerbung = e.target.value; faerben(); });
    faerben();

    karte.on("click", "st-flaeche", (e) => {
      if (e.originalEvent.target.closest(".pin")) return;
      beiStadtteil(e.features[0].properties.name);
    });
    karte.on("mousemove", "st-flaeche", () => { karte.getCanvas().style.cursor = "pointer"; });
    karte.on("mouseleave", "st-flaeche", () => { karte.getCanvas().style.cursor = ""; });
    karte.on("zoom", punkteOderPreise);
    bereit = true;
    aufgeschoben.splice(0).forEach((f) => f());
  });

  // Bei wenigen Marken passen die Preise auch aus der Ferne; bei vielen erst näher dran.
  function punkteOderPreise() {
    behaelter.classList.toggle("weit", karte.getZoom() < (pins.size > 20 ? 11.6 : 9.8));
  }

  function setzePins(liste, gewaehlt) {
    nachher(() => {
      pins.forEach((p) => p.marker.remove());
      pins = new Map();
      for (const { a, b } of liste) {
        const genau = a.lage === "adresse" || a.lage === "strasse";
        const [dx, dy] = genau ? [0, 0] : versatz(a.id);
        const knopf = document.createElement("button");
        knopf.className = `pin ${a.typ} ${b.urteil || "ohne"} ${genau ? "" : "ungefaehr"}`;
        knopf.innerHTML = `<span>${esc(preisKurz(a))}</span>`;
        knopf.setAttribute("aria-label", `${a.stadtteil}: ${eur(a.preis)}`);
        knopf.addEventListener("click", (e) => { e.stopPropagation(); beiPin(a.id); });
        pins.set(a.id, { marker: new maplibregl.Marker({ element: knopf, anchor: "center" }).setLngLat([a.lon + dx, a.lat + dy]).addTo(karte), knopf, a });
      }
      punkteOderPreise();
      markiere(gewaehlt, false);
    });
  }

  function markiere(id, bewegen = true) {
    pins.forEach(({ knopf }, k) => { knopf.classList.toggle("aktiv", k === id); knopf.style.zIndex = k === id ? 5 : ""; });
    const p = pins.get(id);
    if (p && bewegen) karte.easeTo({ center: [p.a.lon, p.a.lat], zoom: Math.max(karte.getZoom(), 12.5), duration: 400 });
  }

  return { setzePins, markiere, aktivSetzen, hinpassen, groesse: () => karte.resize() };
}
