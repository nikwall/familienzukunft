// Karte Wohnen: Stadtteile zum An- und Ausschalten, Preise als Marken, Lärm, Luft, Haltestellen.
import { esc, eur, zahl } from "./format.js";
import { grundstil, gruenUndWasser } from "./kartenbasis.js";

const LAERM = {
  hamburg: {
    kachel: "https://geodienste.hamburg.de/wms_strategische_laermkarten?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=strasse_tag&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}",
    legende: [["#E9F4D0", "55"], ["#F4D5A7", "60"], ["#DA7C77", "65"], ["#9D518B", "70"], ["#7A527F", "75+"]],
    quelle: "Lärmkarte: FHH", hinweis: "",
  },
  eea: {
    kachel: "https://noise.discomap.eea.europa.eu/arcgis/rest/services/noiseStoryMap/NoiseContours_road_lden/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&f=image",
    legende: [["#FFC74A", "55"], ["#FF6600", "60"], ["#FF3333", "65"], ["#990033", "70"], ["#AD9AD6", "75+"]],
    quelle: "Lärm: EEA", hinweis: " nur Hauptstraßen",
  },
};
const LUFT_LEGENDE = [["#e8f0d6", "<10"], ["#f6e09a", "–15"], ["#eeab60", "–20"], ["#cd5e48", "–25"], ["#852956", "25+"]];
const BLAU = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
const AN = "#256abf";
const AUS = "#8c9098";

const METRIK = {
  faktor: { titel: "Kaufpreisfaktor", knopf: "Faktor", einheit: "Jahresmieten", d: 1, wert: (p) => (p?.wohnung?.kauf && p?.wohnung?.miete ? p.wohnung.kauf / (p.wohnung.miete * 12) : null) },
  kauf: { titel: "Kaufpreis Wohnung", knopf: "Kauf €/m²", einheit: "€/m²", d: 0, wert: (p) => p?.wohnung?.kauf ?? null },
  miete: { titel: "Miete Wohnung", knopf: "Miete €/m²", einheit: "€/m²", d: 1, wert: (p) => p?.wohnung?.miete ?? null },
};
const FOLGE = ["", "faktor", "kauf", "miete"];

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

export function baueKarte(behaelter, { stadt, stadtteile, preise, bahn, luft, beiStadtteil, beiPin, melden }) {
  const karte = new maplibregl.Map({
    container: behaelter, style: "https://tiles.openfreemap.org/styles/positron",
    center: stadt.mitte, zoom: stadt.zoom, minZoom: 9.5, maxZoom: 17, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
  });
  karte.touchZoomRotate.disableRotation();
  karte.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

  for (const f of stadtteile.features) {
    for (const [k, m] of Object.entries(METRIK)) {
      const w = m.wert(preise.werte[f.properties.name]);
      if (w != null) f.properties[k] = w;
    }
  }

  const laermArt = LAERM[stadt.laerm];
  const preisknopf = preise.ebene !== "stadt";
  const leiste = document.createElement("div");
  leiste.className = "ebenen";
  leiste.setAttribute("role", "group");
  leiste.setAttribute("aria-label", "Kartenebenen");
  leiste.innerHTML = `
    <button data-e="laerm" aria-pressed="false">Lärm</button>
    <button data-e="luft" aria-pressed="false">Luft</button>
    <button data-e="bahn" aria-pressed="true">${esc(stadt.bahnKurz)}</button>
    ${preisknopf ? `<button data-e="preis" aria-pressed="false">Preise</button>` : ""}`;
  behaelter.appendChild(leiste);
  const legende = document.createElement("div");
  legende.className = "legende";
  behaelter.appendChild(legende);
  const knopf = (e) => leiste.querySelector(`[data-e="${e}"]`);
  const an = (e) => knopf(e)?.getAttribute("aria-pressed") === "true";

  let faerbung = "";
  let aktivMenge = new Set();
  let pins = new Map();
  let bereit = false;
  const aufgeschoben = [];
  const nachher = (f) => (bereit ? f() : aufgeschoben.push(f));

  function legendeZeichnen() {
    let h = "";
    const m = METRIK[faerbung];
    if (m) {
      const br = brueche(stadtteile.features.map((f) => f.properties[faerbung]), BLAU.length);
      h += `<div class="lg"><b>${m.titel}</b><div class="skala">${BLAU.map((c) => `<i style="background:${c}"></i>`).join("")}</div><div class="skala-z"><span>${zahl(br[0], m.d)}</span><span>${zahl(br[br.length - 1], m.d)} ${m.einheit}</span></div></div>`;
    }
    if (an("laerm")) h += `<div class="lg"><b>Straßenlärm dB</b><span>${laermArt.hinweis}</span><div class="zeilen">${laermArt.legende.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join("")}</div></div>`;
    if (an("luft")) h += `<div class="lg"><b>NO₂ 2024, µg/m³</b><div class="zeilen">${LUFT_LEGENDE.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join("")}</div></div>`;
    h += `<div class="lg zeilen"><span><i class="k guenstig"></i>günstig</span><span><i class="k fair"></i>üblich</span><span><i class="k teuer"></i>teuer</span><span><i class="k voll"></i>Kauf</span><span><i class="k hohl"></i>Miete</span></div>`;
    legende.innerHTML = h;
  }

  function faerben() {
    const aktiv = ["boolean", ["feature-state", "an"], false];
    let farbeAn = AN;
    if (faerbung) {
      const br = brueche(stadtteile.features.map((f) => f.properties[faerbung]), BLAU.length);
      const stufen = ["step", ["to-number", ["get", faerbung], 0], BLAU[0]];
      br.forEach((b, i) => stufen.push(b, BLAU[i + 1]));
      farbeAn = ["case", ["has", faerbung], stufen, AN];
    }
    karte.setPaintProperty("st-flaeche", "fill-color", ["case", aktiv, farbeAn, AUS]);
    karte.setPaintProperty("st-flaeche", "fill-opacity", ["case", aktiv, faerbung ? 0.55 : 0.16, 0.32]);
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
      // Hamburg reicht bis zur Insel Neuwerk; der Rahmen hält die Ansicht auf der Stadt.
      if (stadt.rahmen) { w = Math.max(w, stadt.rahmen[0]); s = Math.max(s, stadt.rahmen[1]); o = Math.min(o, stadt.rahmen[2]); n = Math.min(n, stadt.rahmen[3]); }
      if (w < o) karte.fitBounds([[w, s], [o, n]], { padding: 40, duration: 500, maxZoom: 13.6 });
    });
  }

  karte.once("style.load", () => {
    const erste = karte.getStyle().layers.find((l) => l.type === "symbol")?.id;
    grundstil(karte);
    karte.addSource("stadtteile", { type: "geojson", data: stadtteile });
    karte.addLayer({ id: "st-flaeche", type: "fill", source: "stadtteile", paint: { "fill-color": AUS, "fill-opacity": 0.32 } }, erste);
    gruenUndWasser(karte, erste);
    karte.addLayer({ id: "st-linie", type: "line", source: "stadtteile", paint: { "line-color": "#ffffff", "line-width": 1 } }, erste);
    if (stadt.heimat) karte.addLayer({ id: "st-heimat", type: "line", source: "stadtteile", filter: ["==", ["get", "name"], stadt.heimat], paint: { "line-color": "#173A5E", "line-width": 2.5 } });

    karte.addSource("laerm", { type: "raster", tiles: [laermArt.kachel], tileSize: 256, attribution: laermArt.quelle });
    karte.addLayer({ id: "laerm", type: "raster", source: "laerm", layout: { visibility: "none" }, paint: { "raster-opacity": 0.65 } });

    karte.addSource("luft", { type: "image", url: `data/${stadt.id}/${luft.bild}`, coordinates: luft.ecken });
    karte.addLayer({ id: "luft", type: "raster", source: "luft", layout: { visibility: "none" }, paint: { "raster-opacity": 0.5, "raster-resampling": "linear" } }, "gruen-oben");
    karte.addSource("station", { type: "geojson", data: { type: "FeatureCollection", features: luft.stationen.filter((s) => s.no2 != null).map((s) => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: { ...s, wert: String(Math.round(s.no2)) } })) } });
    karte.addLayer({ id: "station", type: "circle", source: "station", layout: { visibility: "none" }, paint: { "circle-radius": 11, "circle-color": "#ffffff", "circle-stroke-color": "#852956", "circle-stroke-width": 2 } });
    karte.addLayer({ id: "station-wert", type: "symbol", source: "station", layout: { visibility: "none", "text-field": ["get", "wert"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": "#852956" } });

    karte.addSource("bahn", { type: "geojson", data: { type: "FeatureCollection", features: bahn.map((b) => ({ type: "Feature", geometry: { type: "Point", coordinates: [b.lon, b.lat] }, properties: { name: b.name } })) } });
    karte.addLayer({ id: "bahn", type: "circle", source: "bahn", minzoom: 10.5, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10.5, 2.5, 14, 5], "circle-color": "#ffffff", "circle-stroke-color": "#173A5E", "circle-stroke-width": 1.5 } });
    karte.addLayer({ id: "bahn-name", type: "symbol", source: "bahn", minzoom: 13, layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.0], "text-anchor": "top", "text-optional": true }, paint: { "text-color": "#173A5E", "text-halo-color": "#ffffff", "text-halo-width": 1.2 } });

    const EBENEN = { laerm: ["laerm"], luft: ["luft", "station", "station-wert"], bahn: ["bahn", "bahn-name"] };
    leiste.addEventListener("click", (e) => {
      const b = e.target.closest("[data-e]");
      if (!b) return;
      const name = b.dataset.e;
      if (name === "preis") {
        faerbung = FOLGE[(FOLGE.indexOf(faerbung) + 1) % FOLGE.length];
        b.setAttribute("aria-pressed", String(!!faerbung));
        b.textContent = faerbung ? METRIK[faerbung].knopf : "Preise";
        faerben();
        return;
      }
      const jetzt = !an(name);
      b.setAttribute("aria-pressed", String(jetzt));
      EBENEN[name].forEach((i) => karte.setLayoutProperty(i, "visibility", jetzt ? "visible" : "none"));
      legendeZeichnen();
    });
    faerben();

    karte.on("click", (e) => {
      if (e.originalEvent.target.closest(".pin")) return;
      const st = an("luft") && karte.queryRenderedFeatures(e.point, { layers: ["station"] })[0];
      if (st) {
        const p = st.properties;
        melden(`${p.name} (${p.typ}), ${luft.jahr_stationen}: NO₂ ${zahl(Number(p.no2))} µg/m³${p.pm25 && p.pm25 !== "null" ? `, PM2,5 ${zahl(Number(p.pm25), 1)}` : ""}`);
        return;
      }
      const f = karte.queryRenderedFeatures(e.point, { layers: ["st-flaeche"] })[0];
      if (f) beiStadtteil(f.properties.name);
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
        const pin = document.createElement("button");
        pin.className = `pin ${a.typ} ${b.urteil || "ohne"} ${genau ? "" : "ungefaehr"}`;
        pin.innerHTML = `<span>${esc(preisKurz(a))}</span>`;
        pin.setAttribute("aria-label", `${a.stadtteil}: ${eur(a.preis)}`);
        pin.addEventListener("click", (e) => { e.stopPropagation(); beiPin(a.id); });
        pins.set(a.id, { marker: new maplibregl.Marker({ element: pin, anchor: "center" }).setLngLat([a.lon + dx, a.lat + dy]).addTo(karte), knopf: pin, a });
      }
      punkteOderPreise();
      markiere(gewaehlt, false);
    });
  }

  function markiere(id, bewegen = true) {
    pins.forEach(({ knopf: k }, i) => { k.classList.toggle("aktiv", i === id); k.style.zIndex = i === id ? 5 : ""; });
    const p = pins.get(id);
    if (p && bewegen) karte.easeTo({ center: [p.a.lon, p.a.lat], zoom: Math.max(karte.getZoom(), 12.5), duration: 400 });
  }

  return { setzePins, markiere, aktivSetzen, hinpassen, groesse: () => karte.resize(), entfernen: () => karte.remove() };
}
