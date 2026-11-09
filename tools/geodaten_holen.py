"""Holt die öffentlichen Hamburg-Daten und legt sie klein unter data/hamburg/ ab.

Nur bei Bedarf von Hand starten (einmal im Jahr reicht):  python tools/geodaten_holen.py

Quellen
- Stadtteile, Grundschulen, Stadtteilprofile, HVV: geodienste.hamburg.de (Datenlizenz Deutschland)
- Preise je Stadtteil: immobilienpreise-2026.de (Angebotsdaten, Methode dort nicht offengelegt)
"""
from __future__ import annotations

import html
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ZIEL = Path(__file__).resolve().parent.parent / "data" / "hamburg"
GEO = "https://geodienste.hamburg.de"
UA = {"User-Agent": "Mozilla/5.0 (Familienzukunft; einmalige Datenabfrage)"}
BBOX = (9.6, 53.35, 10.35, 53.76)  # Hamburg grob


def holen(url: str, params: dict | None = None) -> str:
    if params:
        url += "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return r.read().decode("utf-8-sig", errors="replace")


def wfs(dienst: str, typ: str, fmt: str = "application/geo+json") -> str:
    return holen(f"{GEO}/{dienst}", {
        "SERVICE": "WFS", "VERSION": "1.1.0", "REQUEST": "GetFeature",
        "typeName": typ, "outputFormat": fmt, "srsName": "EPSG:4326",
    })


def schluessel(name: str) -> str:
    """Macht Stadtteilnamen aus verschiedenen Quellen vergleichbar."""
    n = name.lower().strip()
    n = n.replace("sankt ", "st. ").replace("ß", "ss")
    n = re.sub(r"^hamburg-", "", n)
    return re.sub(r"[^a-zäöü0-9]", "", n)


# ---------------------------------------------------------------- Vereinfachen


def dp(punkte: list, toleranz: float) -> list:
    """Douglas-Peucker ohne Zusatzpakete."""
    if len(punkte) < 3:
        return punkte
    behalten = [False] * len(punkte)
    behalten[0] = behalten[-1] = True
    stapel = [(0, len(punkte) - 1)]
    while stapel:
        a, b = stapel.pop()
        (x1, y1), (x2, y2) = punkte[a][:2], punkte[b][:2]
        dx, dy = x2 - x1, y2 - y1
        nenner = dx * dx + dy * dy or 1e-18
        grenze, idx = toleranz * toleranz, -1
        for i in range(a + 1, b):
            px, py = punkte[i][:2]
            t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / nenner))
            d = (px - x1 - t * dx) ** 2 + (py - y1 - t * dy) ** 2
            if d > grenze:
                grenze, idx = d, i
        if idx >= 0:
            behalten[idx] = True
            stapel += [(a, idx), (idx, b)]
    return [p for p, k in zip(punkte, behalten) if k]


def ring_klein(ring: list) -> list:
    r = [[round(x, 5), round(y, 5)] for x, y in (p[:2] for p in dp(ring, 0.00018))]
    if r[0] != r[-1]:
        r.append(r[0])
    return r if len(r) >= 4 else [[round(p[0], 5), round(p[1], 5)] for p in ring]


# ---------------------------------------------------------------- Teile


def stadtteile() -> dict[str, str]:
    d = json.loads(wfs("HH_WFS_Verwaltungsgrenzen", "app:stadtteile"))
    aus, namen = [], {}
    for f in d["features"]:
        name = f["properties"]["stadtteil_name"]
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        klein = [[ring_klein(r) for r in p] for p in polys]
        aus.append({
            "type": "Feature",
            "id": int(f["properties"]["stadtteil_nummer"]),
            "properties": {"name": name, "bezirk": f["properties"]["bezirk_name"]},
            "geometry": {"type": "MultiPolygon", "coordinates": klein},
        })
        namen[schluessel(name)] = name
    schreiben("stadtteile.geojson", {"type": "FeatureCollection", "features": aus})
    return namen


def zahl(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def profile(namen: dict[str, str]) -> None:
    d = json.loads(wfs("wfs_regionalstatistische_daten_stadtteile",
                       "de.hh.up:regionalstatistische_daten_stadtteile"))
    zeilen = [f["properties"] for f in d["features"]]
    jahr = max(z["jahr"] for z in zeilen)
    aus, fehlt = {}, []
    for z in (z for z in zeilen if z["jahr"] == jahr):
        name = namen.get(schluessel(z["stadtteil"]))
        if not name:
            fehlt.append(z["stadtteil"])
            continue
        aus[name] = {
            "einw": zahl(z.get("bev_insgesamt")),
            "dichte": zahl(z.get("flaeche_einw_pro_ha")),
            "efh": zahl(z.get("wohn_wohnungen_in_1_und_2_fam_haeusern_proz")),
            "kinder_hh": zahl(z.get("hau_haushalte_mit_kindern_proz")),
            "u18": zahl(z.get("bev_u18_proz")),
            "whg_qm": zahl(z.get("wohn_avg_wohnungsgroesse_in_qm")),
            "grundschulen": zahl(z.get("inf_grundschulen_anz")),
        }
    print("Profile:", len(aus), "Jahr", jahr, "ohne Zuordnung:", fehlt)
    schreiben("stadtteile_profil.json", {"jahr": int(jahr), "quelle": "Statistikamt Nord, Regionalstatistische Daten der Stadtteile", "werte": aus})


def preise(namen: dict[str, str]) -> None:
    t = holen("https://www.immobilienpreise-2026.de/hamburg")
    bloecke = re.split(r"(Durchschnittspreise für (?:Häuser|Wohnungen) pro Jahr)", t)
    aus: dict[str, dict] = {}
    fehlt = set()
    for marke, block in zip(bloecke[1::2], bloecke[2::2]):
        art = "haus" if "Häuser" in marke else "wohnung"
        for tb in re.findall(r"<table.*?</table>", block, re.S | re.I):
            kopf = re.findall(r"<th[^>]*>(.*?)</th>", tb, re.S | re.I)
            if not kopf or "Stadtteil" not in kopf[0]:
                continue
            for zeile in re.findall(r"<tr.*?</tr>", tb, re.S | re.I)[1:]:
                z = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
                     for c in re.findall(r"<td[^>]*>(.*?)</td>", zeile, re.S | re.I)]
                if len(z) < 4:
                    continue
                roh = {"altstadt": "Hamburg-Altstadt", "neustadt": "Neustadt"}.get(z[0].lower(), z[0])
                name = namen.get(schluessel(roh))
                if not name:
                    fehlt.add(z[0])
                    continue
                kauf = zahl(re.sub(r"[^\d]", "", z[1]))
                miete = zahl(re.sub(r"[^\d,]", "", z[3]).replace(",", "."))
                aus.setdefault(name, {})[art] = {"kauf": kauf, "miete": miete}
    print("Preise:", len(aus), "ohne Zuordnung:", sorted(fehlt))
    schreiben("preise_stadtteile.json", {
        "stand": "Q3 2026",
        "quelle": "immobilienpreise-2026.de (Angebotsdaten, Methode dort nicht offengelegt)",
        "werte": aus,
    })


def grundschulen() -> None:
    aus = []
    for typ, traeger in (("de.hh.up:staatliche_schulen", "staatlich"), ("de.hh.up:nicht_staatliche_schulen", "frei")):
        d = json.loads(wfs("HH_WFS_Schulen", typ))
        for f in d["features"]:
            p = f["properties"]
            if "grundschule" not in (p.get("schulform") or "").lower():
                continue
            x, y = f["geometry"]["coordinates"][:2]
            aus.append({
                "name": re.sub(r"\s+", " ", p.get("schulname") or "").strip(),
                "lon": round(x, 5), "lat": round(y, 5),
                "stadtteil": p.get("stadtteil"), "traeger": traeger,
                "ganztag": p.get("ganztagsform"), "web": p.get("schul_homepage"),
            })
    print("Grundschulen:", len(aus))
    schreiben("grundschulen.json", aus)


def schnellbahn() -> None:
    t = wfs("wfs_hvv", "geofox_workspace:geofoxdb_stations", "application/json")
    # Der Dienst liefert kein gültiges JSON (z. B. "id"0), daher Feld für Feld lesen.
    muster = re.compile(
        r'"coordinates":\[([\d.]+),([\d.]+)\].*?"name":"([^"]*)".*?"lines":"([^"]*)".*?"lineshortkat":"([^"]*)"')
    orte: dict[str, dict] = {}
    for m in muster.finditer(t):
        x, y = float(m[1]), float(m[2])
        art = set(m[5].split(","))
        if not art & {"U", "S", "A", "R"}:
            continue
        if not (BBOX[0] <= x <= BBOX[2] and BBOX[1] <= y <= BBOX[3]):
            continue
        linien = [l for l in m[4].split(",") if re.fullmatch(r"(U|S|A|R|RB|RE)\d+", l)]
        name = re.sub(r"\s+", " ", m[3]).strip()
        o = orte.setdefault(name, {"name": name, "lon": round(x, 5), "lat": round(y, 5), "linien": set()})
        o["linien"] |= set(linien)
    aus = sorted(({**o, "linien": sorted(o["linien"])} for o in orte.values()), key=lambda o: o["name"])
    print("Schnellbahn:", len(aus))
    schreiben("schnellbahn.json", aus)


def schreiben(datei: str, obj) -> None:
    p = ZIEL / datei
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  -> {p.name}: {p.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ZIEL.mkdir(parents=True, exist_ok=True)
    namen = stadtteile()
    profile(namen)
    preise(namen)
    grundschulen()
    schnellbahn()
