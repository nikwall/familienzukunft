"""Baut die Kandidatenliste für das Vorschuljahr: Kitas und Vorschulklassen im Umkreis.

    python tools/vorschule_holen.py details.json

Einmal im Jahr reicht. details.json enthält je Kita Träger und Website aus dem Kita-Infosystem.

Quellen
- Kitas: Geoportal Hamburg, HH_WFS_KitaEinrichtung (Kinderzahl, Fläche, Leistungsarten)
- Schulen: Geoportal Hamburg, HH_WFS_Schulen
- Schwerpunkte und Gruppengrößen: Stichworte auf den eigenen Websites der Einrichtungen.
  Es wird nichts geraten: Was dort nicht steht, bleibt leer.
"""
from __future__ import annotations

import html
import json
import math
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ZIEL = Path(__file__).resolve().parent.parent / "data" / "hamburg" / "vorschule.json"
GEO = "https://geodienste.hamburg.de"
UA = {"User-Agent": "Mozilla/5.0 (vinifeli; private Suche nach Vorschulplatz, einmalige Abfrage)"}
MITTE = (53.5766264, 9.9675375)  # Scheideweg
RADIUS = 3000
GEHMETER_PRO_MIN = 75  # mit Kind
UMWEG = 1.3

MERKMALE = [
    ("Montessori", r"montessori"),
    ("Waldorf", r"waldorf|anthroposoph"),
    ("Reggio", r"reggio"),
    ("Situationsansatz", r"situationsansatz|situationsorientiert"),
    ("Offene Arbeit", r"offene[nrs]?\s+(?:arbeit|konzept|gruppen|pädagogik)|teiloffen"),
    ("Zweisprachig", r"bilingual|zweisprachig|immersion|deutsch-(?:englisch|spanisch|französisch|chinesisch|italienisch)|spanisch-deutsch"),
    ("Musik", r"musikkindergarten|musik-?kita|musikalische[nr]?\s+(?:früh)?(?:erziehung|bildung|förderung)|schwerpunkt\s+musik"),
    ("Bewegung", r"bewegungskita|bewegungskindergarten|bewegungserziehung|psychomotorik|schwerpunkt\s+bewegung"),
    ("Natur", r"naturpädagog|waldtag|waldwoche|waldgruppe|waldkindergarten|naturnah"),
    ("Kunst", r"kunst-?kita|kunstpädagog|atelier"),
    ("Forschen", r"forscherraum|forscherwerkstatt|haus der kleinen forscher|mint-"),
    ("Eigene Küche", r"eigene[nr]?\s+küche|frisch\s+(?:zu\w*\s+)?gekocht|hauseigene[nr]?\s+küche|bio-?küche"),
]
UNTERSEITEN = re.compile(r"konzept|p(?:ä|ae|%C3%A4)dagog|profil|ueber|über|about|angebot|gruppe|alltag|vorschul", re.I)
GRUPPE = [
    re.compile(r"(?:gruppe|gruppen)\b[^.!?\n]{0,50}?\b(\d{2})\s+kinder", re.I),
    re.compile(r"\b(\d{2})\s+kinder[^.!?\n]{0,30}?\b(?:pro|je|in\s+einer|in\s+jeder)\s+gruppe", re.I),
]


def abstand(a, b, c, d) -> float:
    r = math.radians
    x = r(d - b) * math.cos(r((a + c) / 2))
    return 6_371_000 * math.hypot(x, r(c - a))


def wfs(dienst: str, typ: str) -> list:
    url = f"{GEO}/{dienst}?" + urllib.parse.urlencode({
        "SERVICE": "WFS", "VERSION": "1.1.0", "REQUEST": "GetFeature", "typeName": typ,
        "outputFormat": "application/geo+json", "srsName": "EPSG:4326"})
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return json.loads(r.read().decode("utf-8-sig"))["features"]


def seite(url: str) -> str:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15) as r:
            if "html" not in (r.headers.get("Content-Type") or "html"):
                return ""
            return r.read(800_000).decode(r.headers.get_content_charset() or "utf-8", "replace")
    except Exception:
        return ""


def nur_text(h: str) -> str:
    h = re.sub(r"<(script|style|noscript)\b.*?</\1>", " ", h, flags=re.S | re.I)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h)))


def website(url: str | None) -> dict:
    """Liest die Startseite und bis zu vier passende Unterseiten; liefert nur Stichworte."""
    if not url:
        return {}
    if not url.startswith("http"):
        url = "https://" + url
    start = seite(url)
    if not start:
        return {"erreichbar": False}
    host = urllib.parse.urlparse(url).netloc
    links = []
    for href in re.findall(r'href=["\']([^"\'#]+)', start):
        ziel = urllib.parse.urljoin(url, href)
        if urllib.parse.urlparse(ziel).netloc == host and UNTERSEITEN.search(ziel) and not re.search(r"\.(pdf|jpe?g|png|docx?)$", ziel, re.I) and ziel not in links:
            links.append(ziel)
    text = nur_text(start) + " " + " ".join(nur_text(seite(l)) for l in links[:4])
    merkmale = [n for n, m in MERKMALE if re.search(m, text, re.I)]
    gruppen = []
    for m in GRUPPE:
        for t in m.finditer(text):
            satz = text[max(0, t.start() - 40):t.end() + 40].lower()
            n = int(t[1])
            if 8 <= n <= 30 and "krippe" not in satz and "hort" not in satz and "insgesamt" not in satz:
                gruppen.append(n)
    aus = {"erreichbar": True, "merkmale": merkmale, "vorschule": bool(re.search(r"vorschul", text, re.I))}
    if gruppen:
        aus["gruppe"] = Counter(gruppen).most_common(1)[0][0]
    return aus


def stunden(leistungen: list[str]) -> tuple[int | None, bool]:
    el = [l for l in leistungen if l.startswith("Elementar")]
    werte = [int(m[1]) for l in el if (m := re.search(r"(\d+)-stündig", l))]
    return (max(werte) if werte else None), any("5-stündige Betreuung mit Mittagessen" in l for l in el)


TRAEGER = [
    ("Evangelisch", r"^ev\.|evangelisch|kirchengemeinde|kirchenkreis|luther"),
    ("Katholisch", r"^kath\.|katholisch|erzbistum|caritas"),
    ("Jüdisch", r"carlebach|jüdisch"),
    ("Elbkinder (städtisch)", r"elbkinder|vereinigung hamburger kindertagesstätten"),
    ("Kinderladen", r"kinderladen|elterninitiative"),
]


def art_des_traegers(name: str, traeger: str | None) -> str | None:
    t = f"{name} {traeger or ''}"
    return next((n for n, m in TRAEGER if re.search(m, t, re.I)), None)


def kitas(details: dict) -> list:
    neueste: dict[str, dict] = {}
    tag = lambda s: (s[6:] + s[3:5] + s[:2]) if s else ""  # noqa: E731
    for f in wfs("HH_WFS_KitaEinrichtung", "app:KitaEinrichtungen"):
        p = f["properties"]
        x, y = f["geometry"]["coordinates"][:2]
        if abstand(*MITTE, y, x) > RADIUS or "E" not in p["Leistungsarten"]:
            continue
        if f["id"] not in neueste or tag(p.get("Erhebungsstichtag")) > tag(neueste[f["id"]]["properties"].get("Erhebungsstichtag")):
            neueste[f["id"]] = f
    aus = []
    for f in neueste.values():
        p = f["properties"]
        kid = f["id"].split("_")[-1]
        x, y = f["geometry"]["coordinates"][:2]
        m = abstand(*MITTE, y, x)
        d = details.get(kid, {})
        h, frei_mit_essen = stunden(p["Leistungsname"])
        zusatz = p.get("Zusatztextkita") or ""
        kinder = p.get("Anzahl_betreuter_Kinder")
        flaeche = p.get("Pädagogische_Fläche_in_qm")
        name = re.sub(r"\s+", " ", re.sub(r"^KiTa\s+|^KiGa\s+", "", p["Name"])).strip()
        aus.append({
            "id": f"k{kid}", "art": "kita", "name": name,
            "adresse": f"{p['Strasse']} {p['Hausnr']}", "plz": p["PLZ"], "stadtteil": d.get("stadtteil"),
            "lon": round(x, 5), "lat": round(y, 5), "m": round(m), "min": round(m * UMWEG / GEHMETER_PRO_MIN),
            "kinder": kinder, "flaeche": flaeche,
            "qm_kind": round(flaeche / kinder, 1) if kinder and flaeche else None,
            "krippe": "K" in p["Leistungsarten"].replace("KE", "K", 1) and p["Leistungsarten"].startswith("K"),
            "hort": "H" in p["Leistungsarten"],
            "integration": "Eing" in p["Leistungsarten"],
            "stunden": h, "frei_mit_essen": frei_mit_essen,
            "tel": p.get("Telefon"), "web": d.get("web"), "traeger": d.get("traeger"),
            "traegerart": art_des_traegers(p["Name"], d.get("traeger")),
            "betrieblich": "Betrieblich" in zusatz, "privat": "Private" in zusatz,
        })
    return aus


NICHT = re.compile(r"rebbz", re.I)


def schulen() -> list:
    aus = []
    for typ, frei in (("de.hh.up:staatliche_schulen", False), ("de.hh.up:nicht_staatliche_schulen", True)):
        for f in wfs("HH_WFS_Schulen", typ):
            p = f["properties"]
            x, y = f["geometry"]["coordinates"][:2]
            m = abstand(*MITTE, y, x)
            if m > RADIUS or "Vorschulklasse" not in (p.get("schulform") or "") or NICHT.search(p.get("schulname") or ""):
                continue
            kern = [int(z) for z in re.findall(r"Klassenstufe \d\s+(\d+)%", p.get("kernzeitbetreuung") or "")]
            sprachen = sorted({re.sub(r"\s+ab Klasse\s+.*", "", s) for s in (p.get("fremdsprache_mit_klasse") or "").split("|") if "ab Klasse  1" in s})
            aus.append({
                "id": f"s{p['schul_id']}-{p.get('standort_id')}", "art": "schule", "name": re.sub(r"\s+", " ", p["schulname"]).strip(),
                "adresse": p.get("adresse_strasse_hausnr"), "plz": (p.get("adresse_ort") or "")[:5], "stadtteil": p.get("stadtteil"),
                "lon": round(x, 5), "lat": round(y, 5), "m": round(m), "min": round(m * UMWEG / GEHMETER_PRO_MIN),
                "frei": frei, "zweig": p.get("schultyp") not in (None, "Hauptstandort"),
                "ganztag": p.get("ganztagsform"), "zuege": p.get("zuegigkeit_kl_1"), "schueler": p.get("anzahl_schueler"),
                "sozialindex": p.get("sozialindex"), "ferien": p.get("ferienbetreuung_anteil"),
                "kernzeit": round(sum(kern) / len(kern)) if kern else None,
                "inklusion": bool(p.get("schwerpunktschule")), "sprachen": sprachen,
                "tel": p.get("schul_telefonnr"), "web": p.get("schul_homepage"),
            })
    return aus


def nachbessern(x: dict) -> None:
    """Name und Träger verraten oft das Profil; unplausible Gruppengrößen fliegen raus."""
    text = f"{x['name']} {x.get('traeger') or ''}"
    fund = [n for n, m in MERKMALE if re.search(m, text, re.I)]
    if re.search(r"internationale?r?\b|chinesisch|spanisch-deutsch|french|française", text, re.I):
        fund.append("International")
    x["merkmale"] = list(dict.fromkeys([*fund, *x.get("merkmale", [])]))
    # Natürliche Personen als Träger gehören nicht auf eine öffentliche Seite.
    tr = x.get("traeger") or ""
    if re.search(r"^(?:Frau|Herr)\b|[,/]", tr) or not re.search(r"e\.\s?V\.|gGmbH|GmbH|Stiftung|Kirche|Gemeinde|Pfarrei|\bAG\b|AÖR|Verein|Institut|Studierendenwerk|Klinikum", tr):
        x["traeger"] = None
    g = x.get("gruppe")
    if g and (g > 24 or (x.get("kinder") and g >= 0.9 * x["kinder"])):
        x["gruppe"] = None


SCHULGELD = {
    "Katholische Schule": "Schulgeld bis 135 €/Monat, nach Einkommen ab 10 € (Tabelle des Erzbistums, gültig bis Juli 2026)",
}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    details = {str(d["id"]): d for d in json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))}
    k, s = kitas(details), schulen()
    print("Kitas", len(k), "mit Website", sum(1 for x in k if x["web"]), "Schulen", len(s))
    # Eine gemeinsame Träger-Website sagt nichts über die einzelne Einrichtung.
    host = lambda u: urllib.parse.urlparse(u if u.startswith("http") else f"https://{u}").netloc.lower().removeprefix("www.") if u else None  # noqa: E731
    haeufig = Counter(host(x["web"]) for x in k + s if x["web"])
    eigene = lambda e: e["web"] if e["web"] and haeufig[host(e["web"])] == 1 else None  # noqa: E731
    with ThreadPoolExecutor(16) as pool:
        for x, w in zip(k + s, pool.map(lambda e: website(eigene(e)), k + s)):
            x.update({"merkmale": w.get("merkmale", []), "vorschule_web": w.get("vorschule"), "gruppe": w.get("gruppe")})
            x["web_ok"] = w.get("erreichbar", False)
    for x in k + s:
        nachbessern(x)
    for x in s:
        if x["frei"]:
            x["schulgeld"] = next((v for n, v in SCHULGELD.items() if n in x["name"]), "Schulgeld: bei der Schule erfragen")
    print("Website lesbar:", sum(1 for x in k + s if x["web_ok"]), "mit Merkmalen:", sum(1 for x in k + s if x["merkmale"]), "mit Gruppengröße:", sum(1 for x in k + s if x["gruppe"]))
    print(Counter(m for x in k + s for m in x["merkmale"]))
    k.sort(key=lambda x: x["m"])
    s.sort(key=lambda x: x["m"])
    ZIEL.write_text(json.dumps({
        "stand": "2026-11-09", "mitte": {"name": "Scheideweg", "lat": MITTE[0], "lon": MITTE[1]}, "radius": RADIUS, "kitas": k, "schulen": s,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {ZIEL.name}: {ZIEL.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
