"""Holt die Geodaten für Würzburg und Lüneburg und die Luftkarten aller drei Städte.

Nur bei Bedarf von Hand starten (einmal im Jahr reicht):  python tools/staedte_holen.py

Quellen
- Stadtteilgrenzen, Straßenbahn, Grundschulen: OpenStreetMap (Nominatim, Overpass; ODbL)
- Haltestellen Lüneburg: HVV (geodienste.hamburg.de, Datenlizenz Deutschland)
- Preise: immobilienpreise-2026.de (Angebotsdaten, Methode dort nicht offengelegt)
- NO2-Modell 2024, 1 km: Umweltbundesamt (RCG), bezogen über die Europäische Umweltagentur
- Messstationen: Umweltbundesamt, Luftdaten-API
"""
from __future__ import annotations

import html
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from geodaten_holen import ring_klein  # noqa: E402

DATEN = Path(__file__).resolve().parent.parent / "data"
UA = {"User-Agent": "vinifeli/0.1 (private Familien-App; einmalige Abfrage)"}
BROWSER = {"User-Agent": "Mozilla/5.0 (vinifeli; einmalige Datenabfrage)"}

# Luftkarte: feste Klassen, in allen Städten gleich, damit sie vergleichbar bleiben.
# Grenzen: 10 = WHO-Richtwert, 20 = EU-Grenzwert ab 2030.
NO2_KLASSEN = [(10, (232, 240, 214)), (15, (246, 224, 154)), (20, (238, 171, 96)), (25, (205, 94, 72)), (999, (133, 41, 86))]
EEA_NO2 = "https://air.discomap.eea.europa.eu/arcgis/rest/services/AQModelViewer/AQ_8_P1Y/ImageServer/exportImage"
NO2_2024 = 303  # OBJECTID des Datensatzes „2024_1km … MOD.DE_RCG_NO2“
UBA = "https://luftdaten.umweltbundesamt.de/api/air-data/v4"

STAEDTE = {
    "hamburg": {
        "name": "Hamburg", "bbox": (9.70, 53.39, 10.33, 53.74), "preis": None, "teile": None,
    },
    "wuerzburg": {
        "name": "Würzburg", "bbox": (9.84, 49.70, 10.03, 49.86), "preis": "bayern/wuerzburg",
        "teile": ["Altstadt", "Zellerau", "Dürrbachtal", "Grombühl", "Lindleinsmühle", "Frauenland", "Sanderau",
                  "Heidingsfeld", "Heuchelhof", "Steinbachtal", "Versbach", "Lengfeld", "Rottenbauer"],
    },
    "lueneburg": {
        "name": "Lüneburg", "bbox": (10.33, 53.19, 10.50, 53.30), "preis": "niedersachsen/lueneburg",
        "teile": ["Altstadt", "Bockelsberg", "Ebensberg", "Goseburg-Zeltberg", "Häcklingen", "Kaltenmoor", "Kreideberg",
                  "Lüne-Moorfeld", "Mittelfeld", "Neu Hagen", "Ochtmissen", "Oedeme", "Rettmer", "Rotes Feld",
                  "Schützenplatz", "Weststadt", "Wilschenbruch"],
    },
}
OVERPASS = ("https://lz4.overpass-api.de/api/interpreter", "https://overpass-api.de/api/interpreter",
            "https://z.overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter")


def holen(url: str, kopf=UA, daten: bytes | None = None, zeit: int = 90) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=kopf, data=daten), timeout=zeit) as r:
        return r.read()


def nominatim(q: str) -> list:
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "jsonv2", "limit": 3, "countrycodes": "de", "polygon_geojson": 1})
    d = json.loads(holen(url))
    time.sleep(1.1)
    return d


def overpass(abfrage: str, versuche: int = 3):
    for runde in range(versuche):
        for ep in OVERPASS:
            try:
                return json.loads(holen(ep, daten=urllib.parse.urlencode({"data": abfrage}).encode(), zeit=50))["elements"]
            except OSError as e:
                print("  Overpass:", ep.split("/")[2], e)
        time.sleep(15 * (runde + 1))
    raise RuntimeError("Overpass nicht erreichbar")


def schreiben(pfad: Path, obj) -> None:
    pfad.parent.mkdir(parents=True, exist_ok=True)
    pfad.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  -> {pfad.parent.name}/{pfad.name}: {pfad.stat().st_size / 1024:.0f} KB")


def im_ring(x, y, ring) -> bool:
    drin, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi, xj, yj = ring[i][0], ring[i][1], ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            drin = not drin
        j = i
    return drin


def in_polygonen(x, y, features) -> bool:
    return any(im_ring(x, y, p[0]) for f in features for p in f["geometry"]["coordinates"])


# ---------------------------------------------------------------- Stadtteile


def stadtteile(s: dict) -> list:
    aus = []
    for i, name in enumerate(s["teile"], 1):
        treffer = [t for t in nominatim(f"{name}, {s['name']}") if t["geojson"]["type"] in ("Polygon", "MultiPolygon")]
        if not treffer:
            print("  ohne Fläche:", name)
            continue
        g = treffer[0]["geojson"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        aus.append({"type": "Feature", "id": i, "properties": {"name": name},
                    "geometry": {"type": "MultiPolygon", "coordinates": [[ring_klein(r) for r in p] for p in polys]}})
    return aus


# ---------------------------------------------------------------- Preise


def eu(x: str) -> float | None:
    x = re.sub(r"[^\d,]", "", x).replace(",", ".")
    try:
        return float(x)
    except ValueError:
        return None


def tabellen(t: str):
    for tb in re.findall(r"<table.*?</table>", t, re.S | re.I):
        kopf = [re.sub(r"<[^>]+>", "", x).strip() for x in re.findall(r"<th[^>]*>(.*?)</th>", tb, re.S | re.I)]
        zeilen = [[html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S | re.I)]
                  for r in re.findall(r"<tr.*?</tr>", tb, re.S | re.I)[1:]]
        yield kopf, zeilen


def preise(kurz: str, s: dict, namen: list[str]) -> None:
    t = holen(f"https://www.immobilienpreise-2026.de/{s['preis']}", BROWSER).decode("utf-8", "replace")
    tabs = list(tabellen(t))
    jahres = [z for k, z in tabs if k[:3] == ["Jahr", "⌀ Kaufpreis", "⌀ Mietpreis"]]
    stadt = {"haus": {"kauf": eu(jahres[0][-1][1]), "miete": eu(jahres[0][-1][2])},
             "wohnung": {"kauf": eu(jahres[1][-1][1]), "miete": eu(jahres[1][-1][2])}}
    teile = [z for k, z in tabs if k and k[0] == "Stadtteil"]
    werte: dict[str, dict] = {}
    if teile:
        for art, zeilen in zip(("haus", "wohnung"), teile):
            for z in zeilen:
                n = {"Hagen": "Neu Hagen", "Zeltberg": "Goseburg-Zeltberg", "Goseburg": "Goseburg-Zeltberg"}.get(z[0], z[0])
                if n in namen:
                    werte.setdefault(n, {}).setdefault(art, {"kauf": eu(z[1]), "miete": eu(z[3])})
                else:
                    print("  Preis ohne Stadtteil:", z[0])
        fehlt = [n for n in namen if n not in werte]
        print("  ohne Preiszeile:", fehlt)
        for n in fehlt:
            werte[n] = stadt
        ebene = "stadtteil"
    else:
        werte = {n: stadt for n in namen}
        ebene = "stadt"
    schreiben(DATEN / kurz / "preise_stadtteile.json", {
        "stand": "2026", "ebene": ebene, "stadt": stadt,
        "quelle": "immobilienpreise-2026.de (Angebotsdaten, Methode dort nicht offengelegt)", "werte": werte,
    })


# ---------------------------------------------------------------- Wege


def bahn_wuerzburg(features) -> list:
    west, sued, ost, nord = STAEDTE["wuerzburg"]["bbox"]
    roh = overpass(f'[out:json][timeout:30];node({sued},{west},{nord},{ost})["railway"~"^(tram_stop|station|halt)$"];out;')
    orte: dict[str, dict] = {}
    for e in roh:
        name = re.sub(r"\s+[A-Z]$", "", (e.get("tags", {}).get("name") or "").strip())
        if not name or not in_polygonen(e["lon"], e["lat"], features):
            continue
        art = "Straba" if e["tags"].get("railway") == "tram_stop" else "Bahn"
        o = orte.setdefault(name, {"name": name, "lon": round(e["lon"], 5), "lat": round(e["lat"], 5), "linien": [], "art": "bahn"})
        if art not in o["linien"]:
            o["linien"].append(art)
    return sorted(orte.values(), key=lambda o: o["name"])


def halte_lueneburg(features) -> list:
    url = "https://geodienste.hamburg.de/wfs_hvv?" + urllib.parse.urlencode({
        "SERVICE": "WFS", "VERSION": "1.1.0", "REQUEST": "GetFeature", "typeName": "geofox_workspace:geofoxdb_stations",
        "outputFormat": "application/json", "srsName": "EPSG:4326"})
    t = holen(url, BROWSER, zeit=180).decode("utf-8-sig", "replace")
    muster = re.compile(r'"coordinates":\[([\d.]+),([\d.]+)\].*?"name":"([^"]*)".*?"lines":"([^"]*)".*?"lineshortkat":"([^"]*)"')
    orte: dict[str, dict] = {}
    for m in muster.finditer(t):
        x, y = float(m[1]), float(m[2])
        if not in_polygonen(x, y, features):
            continue
        name = re.sub(r"^Lüneburg,?\s*", "", re.sub(r"\s+", " ", m[3]).strip()) or "Lüneburg"
        kat = set(m[5].split(","))
        schiene = bool(kat & {"R", "RB", "RE", "A", "S"})
        linien = [l for l in m[4].split(",") if l][:4]
        o = orte.setdefault(name, {"name": name, "lon": round(x, 5), "lat": round(y, 5), "linien": [], "art": "bahn" if schiene else "bus"})
        o["linien"] = sorted(set(o["linien"]) | set(linien))[:4]
        if schiene:
            o["art"] = "bahn"
    return sorted(orte.values(), key=lambda o: o["name"])


GS = re.compile(r"grundschule|volksschule|\bGS\b|grund- und", re.I)
NICHT_GS = re.compile(r"mittelschule(?!.*grund)|förderzentrum|berufs|gymnasium|realschule", re.I)


def grundschulen(s: dict, features) -> list:
    west, sued, ost, nord = s["bbox"]
    roh = overpass(f'[out:json][timeout:30];nwr({sued},{west},{nord},{ost})["amenity"="school"];out center;')
    aus = {}
    for e in roh:
        t = e.get("tags", {})
        name = (t.get("name") or "").strip()
        x, y = e.get("lon") or e.get("center", {}).get("lon"), e.get("lat") or e.get("center", {}).get("lat")
        if not name or x is None or not GS.search(name) or (NICHT_GS.search(name) and "grund" not in name.lower()):
            continue
        if in_polygonen(x, y, features):
            aus[name] = {"name": name, "lon": round(x, 5), "lat": round(y, 5), "traeger": "frei" if re.search(r"privat|evangel|kathol|waldorf|montessori", name, re.I) else "staatlich"}
    return sorted(aus.values(), key=lambda o: o["name"])


# ---------------------------------------------------------------- Luft


def luftkarte(kurz: str, s: dict) -> dict:
    """Zeichnet das NO2-Modell als kleines Bild mit eigener, überall gleicher Skala."""
    import math
    west, sued, ost, nord = s["bbox"]
    def merc(lon, lat):
        return lon * 20037508.34 / 180, math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137
    x0, y0 = merc(west, sued)
    x1, y1 = merc(ost, nord)
    b, h = max(8, round((x1 - x0) / 500)), max(8, round((y1 - y0) / 500))
    q = urllib.parse.urlencode({
        "bbox": f"{x0},{y0},{x1},{y1}", "bboxSR": 3857, "imageSR": 3857, "size": f"{b},{h}", "format": "tiff", "pixelType": "F32",
        "noData": -1, "interpolation": "RSP_NearestNeighbor", "f": "image",
        "mosaicRule": json.dumps({"mosaicMethod": "esriMosaicLockRaster", "lockRasterIds": [NO2_2024]}),
    })
    roh = Image.open(io.BytesIO(holen(f"{EEA_NO2}?{q}", UA, zeit=120)))
    # Weich hochrechnen, sonst zeichnet das 1-km-Raster harte Kacheln statt Übergänge.
    # Ränder ohne Wert bekommen den Mittelwert, damit sie die Interpolation nicht verfälschen.
    gueltig = [v for v in roh.getdata() if v is not None and v >= 0 and v == v]
    mittel = sum(gueltig) / len(gueltig)
    daten = [(v if v is not None and v >= 0 and v == v else mittel) for v in roh.getdata()]
    glatt = Image.new("F", roh.size)
    glatt.putdata(daten)
    bild = glatt.resize((roh.size[0] * 4, roh.size[1] * 4), Image.BICUBIC)
    px = bild.load()
    aus = Image.new("RGBA", bild.size, (0, 0, 0, 0))
    ziel = aus.load()
    werte = []
    for yy in range(bild.size[1]):
        for xx in range(bild.size[0]):
            v = px[xx, yy]
            if v is None or v < 0 or v != v:
                continue
            werte.append(v)
            ziel[xx, yy] = (*next(c for g, c in NO2_KLASSEN if v < g), 255)
    (DATEN / kurz).mkdir(parents=True, exist_ok=True)
    aus.save(DATEN / kurz / "luft_no2.png", optimize=True)
    print(f"  NO2 {kurz}: {min(werte):.1f}–{max(werte):.1f} µg/m³, {bild.size}, {(DATEN / kurz / 'luft_no2.png').stat().st_size / 1024:.0f} KB")
    return {"bild": "luft_no2.png", "ecken": [[west, nord], [ost, nord], [ost, sued], [west, sued]]}


def stationen_alle() -> list:
    d = json.loads(holen(f"{UBA}/stations/json?lang=de&index=code"))
    k = d["indices"]
    return [dict(zip(k, r)) for r in d["data"].values()]


def jahreswerte(jahr: int, komp: int) -> dict[str, float]:
    d = json.loads(holen(f"{UBA}/annualbalances/json?component={komp}&year={jahr}&lang=de"))
    return {z[0]: float(z[1]) for z in d["data"] if z[1] not in (None, "")}


def stationen(s: dict, alle: list, no2: dict, pm: dict) -> list:
    west, sued, ost, nord = s["bbox"]
    aus = []
    for st in alle:
        x, y = float(st["station longitude"]), float(st["station latitude"])
        if st["station active to"] or not (west <= x <= ost and sued <= y <= nord):
            continue
        n, p = no2.get(st["station id"]), pm.get(st["station id"])
        if n is None and p is None:
            continue
        aus.append({"name": re.sub(r"^.*?/", "", st["station name"]).replace("Hamburg ", ""), "lon": round(x, 4), "lat": round(y, 4),
                    "typ": st["station type name"], "no2": n, "pm25": p})
    return aus


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    nur = set(sys.argv[1:])
    alle = stationen_alle()
    JAHR = 2025
    no2, pm = jahreswerte(JAHR, 5), jahreswerte(JAHR, 9)
    print(f"Luftstationen: {len(alle)}, mit NO2 {JAHR}: {len(no2)}, mit PM2.5: {len(pm)}")
    for kurz, s in STAEDTE.items():
        if nur and kurz not in nur:
            continue
        print("==", s["name"])
        ziel = DATEN / kurz
        if s["teile"]:
            features = stadtteile(s)
            schreiben(ziel / "stadtteile.geojson", {"type": "FeatureCollection", "features": features})
            preise(kurz, s, [f["properties"]["name"] for f in features])
            halte = bahn_wuerzburg(features) if kurz == "wuerzburg" else halte_lueneburg(features)
            print("  Haltestellen:", len(halte))
            schreiben(ziel / "schnellbahn.json", halte)
            gs = grundschulen(s, features)
            print("  Grundschulen:", len(gs), [g["name"] for g in gs])
            schreiben(ziel / "grundschulen.json", gs)
        luft = luftkarte(kurz, s)
        luft["stationen"] = stationen(s, alle, no2, pm)
        luft["jahr_stationen"] = JAHR
        print("  Stationen:", [(x["name"], x["no2"], x["pm25"]) for x in luft["stationen"]])
        schreiben(ziel / "luft.json", luft)


if __name__ == "__main__":
    main()
