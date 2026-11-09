"""Ergänzt Angebote um Lage: Koordinaten, Stadtteil, Schnellbahn, Grundschule, Straßenlärm."""
from __future__ import annotations

import io
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

WURZEL = Path(__file__).resolve().parent.parent
HH = WURZEL / "data" / "hamburg"
UA = {"User-Agent": "vinifeli/0.1 (private Wohnungssuche; geringe Abfragemenge)"}

GEHMETER_PRO_MIN = 80
UMWEG = 1.3  # Luftlinie -> Fußweg

LAERM = [  # Farben, die der Kartendienst für die Lden-Klassen liefert (halbtransparent, Alpha 178)
    ((224, 240, 190), 55), ((242, 197, 130), 60), ((204, 68, 61), 65),
    ((116, 7, 91), 70), ((65, 7, 72), 75),
]
_letzte = 0.0


def _laden(name: str):
    return json.loads((HH / name).read_text(encoding="utf-8"))


STADTTEILE = _laden("stadtteile.geojson")["features"]
BAHN = _laden("schnellbahn.json")
SCHULEN = _laden("grundschulen.json")


def _abstand(a, b, c, d) -> float:
    """Meter zwischen zwei Punkten (lat, lon)."""
    r = math.radians
    x = r(d - b) * math.cos(r((a + c) / 2))
    return 6_371_000 * math.hypot(x, r(c - a))


def nominatim(q: str) -> tuple[float, float] | None:
    global _letzte
    warte = 1.1 - (time.time() - _letzte)
    if warte > 0:
        time.sleep(warte)
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "jsonv2", "limit": 1, "countrycodes": "de"})
    _letzte = time.time()
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
        d = json.load(r)
    return (float(d[0]["lat"]), float(d[0]["lon"])) if d else None


def _im_ring(x, y, ring) -> bool:
    drin = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi, xj, yj = ring[i][0], ring[i][1], ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            drin = not drin
        j = i
    return drin


def stadtteil_von(lat: float, lon: float) -> str | None:
    for f in STADTTEILE:
        for poly in f["geometry"]["coordinates"]:
            if _im_ring(lon, lat, poly[0]) and not any(_im_ring(lon, lat, r) for r in poly[1:]):
                return f["properties"]["name"]
    return None


def _mitte_von(name: str) -> tuple[float, float] | None:
    for f in STADTTEILE:
        if f["properties"]["name"].lower() == name.lower():
            pts = [p for poly in f["geometry"]["coordinates"] for p in poly[0]]
            return sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts)
    return None


def laerm_db(lat: float, lon: float, radius_m: float = 25) -> int:
    """Lauteste Straßenlärm-Klasse (Lden) im Umkreis der Adresse; 0 = unter 55 dB.

    Die Karte spart Gebäude aus. Der Punkt der Adresse liegt oft genau auf dem Haus,
    deshalb zählt der Umkreis, also die Straßenseite des Hauses.
    """
    breite = 0.00032  # etwa 35 m
    laenge = breite / math.cos(math.radians(lat))
    bbox = f"{lat - breite},{lon - laenge},{lat + breite},{lon + laenge}"
    n = 71
    url = ("https://geodienste.hamburg.de/wms_strategische_laermkarten?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap"
           f"&LAYERS=strasse_tag&STYLES=&CRS=EPSG:4326&BBOX={bbox}&WIDTH={n}&HEIGHT={n}&FORMAT=image/png&TRANSPARENT=true")
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
        bild = Image.open(io.BytesIO(r.read())).convert("RGBA")
    m_pro_px = (2 * breite * 111_200) / n
    mitte = n // 2
    hoechst = 0
    for y in range(n):
        for x in range(n):
            if math.hypot(x - mitte, y - mitte) * m_pro_px > radius_m:
                continue
            r_, g, b, a = bild.getpixel((x, y))
            if a < 150:
                continue
            farbe, db = min(LAERM, key=lambda v: (v[0][0] - r_) ** 2 + (v[0][1] - g) ** 2 + (v[0][2] - b) ** 2)
            if (farbe[0] - r_) ** 2 + (farbe[1] - g) ** 2 + (farbe[2] - b) ** 2 < 900:
                hoechst = max(hoechst, db)
    return hoechst


def _naechste(lat, lon, orte):
    best = min(orte, key=lambda o: _abstand(lat, lon, o["lat"], o["lon"]))
    m = _abstand(lat, lon, best["lat"], best["lon"]) * UMWEG
    return best, round(m / GEHMETER_PRO_MIN)


def verorten(a: dict, cache: dict) -> None:
    """Setzt lat/lon und die Genauigkeit: adresse > strasse > plz > stadtteil."""
    versuche = []
    if a.get("strasse"):
        hat_nr = any(ch.isdigit() for ch in a["strasse"])
        versuche.append((f"{a['strasse']}, {a.get('plz') or ''} Hamburg", "adresse" if hat_nr else "strasse"))
    if a.get("plz"):
        versuche.append((f"{a['plz']} Hamburg", "plz"))
    if a.get("stadtteil_text"):
        versuche.append((f"{a['stadtteil_text']}, Hamburg", "stadtteil"))
    for q, genau in versuche:
        if q not in cache:
            try:
                p = nominatim(q)
            except OSError:
                p = None
            cache[q] = list(p) if p else None
        if cache[q]:
            a["lat"], a["lon"], a["lage"] = round(cache[q][0], 5), round(cache[q][1], 5), genau
            return
    if a.get("stadtteil_text") and (m := _mitte_von(a["stadtteil_text"])):
        a["lat"], a["lon"], a["lage"] = round(m[0], 5), round(m[1], 5), "stadtteil"


def anreichern(a: dict, cache: dict) -> None:
    if "lat" not in a:
        verorten(a, cache)
    if "lat" not in a:
        return
    lat, lon = a["lat"], a["lon"]
    if a.get("lage") in ("adresse", "strasse"):
        a["stadtteil"] = stadtteil_von(lat, lon) or a.get("stadtteil_text")
    else:
        # Die Portale ordnen PLZ und Stadtteil oft falsch zu; hier bleibt nur ihre Angabe.
        a["stadtteil"] = a.get("stadtteil_text") or stadtteil_von(lat, lon)
    bahn, min_b = _naechste(lat, lon, BAHN)
    a["bahn"] = {"name": bahn["name"], "linien": bahn["linien"], "min": min_b}
    schule, min_s = _naechste(lat, lon, SCHULEN)
    a["schule"] = {"name": schule["name"], "min": min_s, "traeger": schule["traeger"]}
    if a.get("lage") in ("adresse", "strasse") and "laerm" not in a:
        try:
            a["laerm"] = laerm_db(lat, lon)
        except OSError:
            pass
