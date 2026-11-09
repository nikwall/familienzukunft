// Gemeinsamer Kartenstil: Parks und Gewässer klar erkennbar, auch über eingefärbten Stadtteilen.
const GRUEN = "#b5dca0";
const WALD = "#a3d191";
const WASSER = "#9ccbef";
const NAME_GRUEN = "#2f6b3a";
const NAME_BLAU = "#2b6ea8";

// Die Grundkarte ist fast grau. Hier bekommen Grün und Wasser ihre Farbe,
// damit sie auch außerhalb der aufgelegten Flächen sichtbar sind.
export function grundstil(karte) {
  const setze = (id, art, wert) => { if (karte.getLayer(id)) karte.setPaintProperty(id, art, wert); };
  setze("water", "fill-color", WASSER);
  setze("waterway", "line-color", WASSER);
  setze("park", "fill-color", GRUEN);
  setze("landcover_wood", "fill-color", WALD);
  for (const id of ["water_name_point_label", "water_name_line_label", "waterway_line_label"]) setze(id, "text-color", NAME_BLAU);
}

// Liegen über den Stadtteilflächen, darum ein eigener Satz Ebenen.
export function gruenUndWasser(karte, davor) {
  const q = "openmaptiles";
  karte.addLayer({
    id: "gruen-oben", type: "fill", source: q, "source-layer": "landcover", minzoom: 9,
    filter: ["match", ["get", "class"], ["grass", "wood"], true, false],
    paint: { "fill-color": ["match", ["get", "class"], "wood", WALD, GRUEN], "fill-opacity": 0.85 },
  }, davor);
  karte.addLayer({
    id: "friedhof-oben", type: "fill", source: q, "source-layer": "landuse",
    filter: ["==", ["get", "class"], "cemetery"], paint: { "fill-color": GRUEN, "fill-opacity": 0.7 },
  }, davor);
  karte.addLayer({
    id: "park-oben", type: "fill", source: q, "source-layer": "park",
    filter: ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false],
    paint: { "fill-color": GRUEN, "fill-opacity": 0.7 },
  }, davor);
  karte.addLayer({
    id: "wasser-oben", type: "fill", source: q, "source-layer": "water",
    filter: ["!=", ["get", "brunnel"], "tunnel"], paint: { "fill-color": WASSER, "fill-opacity": 0.95 },
  }, davor);
  karte.addLayer({
    id: "fluss-oben", type: "line", source: q, "source-layer": "waterway",
    filter: ["!=", ["get", "brunnel"], "tunnel"],
    paint: { "line-color": WASSER, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 15, 3] },
  }, davor);
  karte.addLayer({
    id: "park-name", type: "symbol", source: q, "source-layer": "poi", minzoom: 13,
    filter: ["==", ["get", "class"], "park"],
    layout: { "text-field": ["coalesce", ["get", "name:de"], ["get", "name"]], "text-font": ["Noto Sans Italic"], "text-size": 11, "text-optional": true, "text-max-width": 7 },
    paint: { "text-color": NAME_GRUEN, "text-halo-color": "#ffffff", "text-halo-width": 1.2 },
  });
}
