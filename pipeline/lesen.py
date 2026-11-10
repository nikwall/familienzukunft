"""Liest Angebote aus Portal-E-Mails (Suchaufträge) und aus Kartentext.

Regelbasiert und bewusst tolerant: Portale ändern ihre Mails. Was nicht sicher
erkannt wird, bleibt leer, und wird nicht geraten. Namen von Anbietern werden
nicht übernommen.
"""
from __future__ import annotations

import email
import hashlib
import html
import re
import urllib.error
import urllib.parse
import urllib.request
from email.header import decode_header, make_header
from email.message import Message
from urllib.parse import unquote

from bs4 import BeautifulSoup

LINKS = [
    ("immoscout24", re.compile(r"(?:immobilienscout24|is24)\.de/(?:email/)?expose/(\d+)")),
    ("immowelt", re.compile(r"immowelt\.de/(?:expose|projekte/expose)/([\w-]+)")),
    ("kleinanzeigen", re.compile(r"kleinanzeigen\.de/s-anzeige/[^/\s\"']+/(\d+)")),
    ("ohnemakler", re.compile(r"ohne-makler\.net/immobilie/([a-z0-9]+)/")),
]
URL = {
    "immoscout24": "https://www.immobilienscout24.de/expose/{}",
    "immowelt": "https://www.immowelt.de/expose/{}",
    "kleinanzeigen": "https://www.kleinanzeigen.de/s-anzeige/{}",
    "ohnemakler": "https://www.ohne-makler.net/immobilie/{}/",
}

ART = {
    "Reihenhaus": "Reihenhaus", "Reihenmittelhaus": "Reihenhaus", "Reihenendhaus": "Reihenhaus",
    "Doppelhaus": "Doppelhaus", "Stadthaus": "Stadthaus", "Einfamilienhaus": "Haus", "Bungalow": "Haus", "Villa": "Haus",
    "Penthouse": "Penthouse", "Maisonette": "Maisonette", "Terrassenwohnung": "Terrassenwohnung",
    "Dachgeschoss": "Dachgeschoss", "Souterrain": "Souterrain", "Studio": "Studio", "Loft": "Loft",
    "Haus": "Haus", "Wohnung": "Wohnung",
}
# Harte Ausschlüsse: keine echten Angebote oder für uns nicht zugänglich.
AUSSCHLUSS = [
    (re.compile(r"tauschwohnung|wohnungstausch|nur zum tausch", re.I), "Tauschwohnung"),
    (re.compile(r"wohnberechtigungsschein|\bWBS\b", re.I), "nur mit WBS"),
    (re.compile(r"\bzwangsversteigerung|versteigerung\b", re.I), "Versteigerung"),
    (re.compile(r"wohnen auf zeit|möbliert auf zeit|zwischenmiete|untermiete", re.I), "Zeitwohnen"),
    (re.compile(r"mehrfamilienhaus|zinshaus", re.I), "Mehrfamilienhaus"),
    (re.compile(r"massa haus|allkauf|bien[- ]zenker|town ?& ?country|kern-?haus|heinz von heiden|okal\b|fingerhut haus|danwood", re.I), "Katalog-Neubau"),
]
STAEDTE = "Hamburg|Würzburg|Lüneburg"
# Immowelt verschickt nur verschlüsselte Klick-Links; das Ziel steht erst in der Weiterleitung.
KLICK = re.compile(r"click\.by\.immowelt\.de/\?qs=")
EXPOSE_IW = re.compile(r"immowelt\.de/(?:expose|projekte/expose)/([\w-]+)")
KEIN_INSERAT = re.compile(r"platziere|inserieren|karte anzeigen|immobilienpreise|app", re.I)
UA = {"User-Agent": "vinifeli/0.2 (private Wohnungssuche; folgt nur den Links der eigenen Suchauftrags-Mails)"}


def _zahl(s: str | None) -> float | None:
    """Deutsche Zahl: 1.234,5 -> 1234.5"""
    if not s:
        return None
    s = s.strip().replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


Z = r"(\d[\d.\s ]*(?:,\d+)?)"


def _typ(text: str) -> str | None:
    if re.search(r"kaltmiete|zur miete|\bmiete\b|/\s*monat\s*kalt|mietwohnung|zu vermieten", text, re.I):
        if not re.search(r"\bzum kauf\b|kaufpreis", text, re.I):
            return "miete"
    if re.search(r"zum kauf|kaufpreis|eigentumswohnung|provisionsfrei.*kauf|kapitalanlage", text, re.I):
        return "kauf"
    return None


def _ort(text: str) -> dict:
    """Findet „Straße Nr, Stadtteil, Stadt (PLZ)“ und die kürzeren Formen der Mails."""
    leer = {"ort": None, "plz": None, "stadtteil_text": None, "strasse": None}
    m = re.search(rf"(?:^|\|\s*)([^|]*?)\b({STAEDTE})\s*\((\d{{5}})\)", text)
    if m:
        teile = [t.strip() for t in m[1].split(",") if t.strip()]
        stadtteil, strasse = None, None
        if teile:
            stadtteil = teile[-1]
            if len(teile) >= 2:
                strasse = teile[0]
        return {"ort": m[2], "plz": m[3], "stadtteil_text": stadtteil, "strasse": strasse}
    # „Sasel, Hamburg“ oder „Musterweg 3, Sasel, Hamburg“, ohne Postleitzahl
    m = re.search(rf"(?:^|\|\s*)([^|]*?),\s*({STAEDTE})\s*(?:\||$)", text)
    if m:
        teile = [t.strip() for t in m[1].split(",") if t.strip()]
        if teile and len(teile[-1]) <= 40:
            return {**leer, "ort": m[2], "stadtteil_text": teile[-1], "strasse": teile[0] if len(teile) >= 2 else None}
    # „Musterstraße 3, 20253 Hamburg, Eimsbüttel“ oder „20253 Hamburg-Eimsbüttel“
    m = re.search(rf"\b(\d{{5}})\s+({STAEDTE})(?:[,\s-]+([A-ZÄÖÜ][\wäöüß. -]{{2,30}}?))?(?=\s*(?:\||$|,|·))", text)
    if m:
        vorn = re.search(r"([A-ZÄÖÜ][\wäöüß.\- ]{2,40}\s\d+\s?[a-zA-Z]?)\s*,\s*$", text[:m.start()])
        return {"ort": m[2], "plz": m[1], "stadtteil_text": (m[3] or "").strip() or None, "strasse": vorn[1].strip() if vorn else None}
    # „Hamburg, Eimsbüttel“ ohne Postleitzahl
    m = re.search(rf"\b({STAEDTE})\s*[,-]\s*([A-ZÄÖÜ][\wäöüß. -]{{2,30}}?)(?=\s*(?:\||$|,|·))", text)
    if m:
        return {**leer, "ort": m[1], "stadtteil_text": m[2].strip()}
    return leer


def lies_text(text: str, quelle: str, ext_id: str, url: str | None = None, typ: str | None = None) -> dict:
    """Liest Preis, Fläche, Zimmer usw. aus dem Text einer Kartenansicht oder Mail."""
    t = re.sub(r"\s+", " ", html.unescape(text)).strip()
    # Ausschlusskriterien
    grund = next((g for r, g in AUSSCHLUSS if r.search(t)), None)
    typ = typ or _typ(t)

    preis, qm_preis = None, None
    m = re.search(Z + r"\s*€\s*" + Z + r"\s*€/m²", t)
    spanne = re.search(r"(\d[\d.]*(?:,\d+)?)\s*[–-]\s*\d[\d.]*(?:,\d+)?\s*€(?!/m)", t)
    if m:
        preis, qm_preis = _zahl(m[1]), _zahl(m[2])
    elif spanne:
        preis = _zahl(spanne[1])
    else:
        for m in re.finditer(Z + r"\s*(?:€|EUR|Euro)(?!/m)", t):
            w = _zahl(m[1])
            if w and w >= 100:
                preis = w
                break

    m = re.search(r"€[\s|]*" + Z + r"\s*m²(?!\s*Grund)", t) or re.search(Z + r"\s*(?:m²|qm|m2)\b", t)
    flaeche = _zahl(m[1]) if m else None
    m = (re.search(r"(\d+(?:,\d)?)\s*Zi\.", t) or re.search(r"(\d+(?:,\d)?)\s+Zimmer\b", t)
         or re.search(r"(\d+(?:,\d)?)\s*(?:Zimmer|-Zimmer)", t))
    zimmer = _zahl(m[1]) if m else None

    art = next((v for k, v in ART.items() if re.search(rf"\b{k}", t, re.I)), None)
    if art in (None, "Wohnung") and re.search(r"(?<!mehrfamilien)haus(?![\w-])", t, re.I):
        art = "Haus"
    m = re.search(r"frei ab (sofort|\d{2}\.\d{2}\.\d{4})", t, re.I)
    frei = m[1] if m else None
    m = re.search(r"\|\s*(A\+|[A-H])\s*(?:\||$)", t)
    energie = m[1] if m else None
    m = re.search(r"(?:Geschoss\s*)?(EG|\d+)/(\d+)", t) if "Geschoss" in t else None
    etage = f"{m[1]}/{m[2]}" if m else None
    if not etage:
        m = re.search(r"(EG\b|\d+\.\s*Geschoss)", t)
        etage = m[1].replace(". Geschoss", ".OG") if m else None

    a = {
        "id": f"{quelle}:{ext_id}", "quelle": quelle, "url": url or URL[quelle].format(ext_id),
        "typ": typ, "art": art, "preis": preis, "flaeche": flaeche, "zimmer": zimmer,
        "etage": etage, "frei_ab": frei, "energie": energie,
        "privat": bool(re.search(r"\bvon privat\b|\bprivat vo[mn]\b", t, re.I)),
        "provisionsfrei": bool(re.search(r"provisionsfrei", t, re.I)),
        "neubau": bool(re.search(r"erstbezug|neubau", t, re.I)),
        "kapitalanlage": bool(re.search(r"kapitalanlage|vermietet", t, re.I)),
        "balkon": True if re.search(r"balkon|loggia", t, re.I) else None,
        "terrasse": True if re.search(r"terrasse", t, re.I) else None,
        "garten": True if re.search(r"(?<![a-zäöü-])(?:privat)?garten(?:wohnung|anteil|nutzung|teil)?(?![a-zäöü])", t, re.I) else None,
        "ausschluss": grund,
        **_ort(t),
    }
    if qm_preis and flaeche and not preis:
        a["preis"] = qm_preis * flaeche
    if not a["typ"] and a["preis"]:
        # Ohne Hinweis im Text verrät die Größenordnung die Art: Mieten liegen weit unter 30.000 €.
        a["typ"] = "kauf" if a["preis"] >= 30_000 else "miete"
    # Hausbaufirmen bewerben Katalog-Neubauten mit krummen Preisen wie 677.842 €; echte Häuser
    # kosten fast immer glatte Hunderter. Das trifft nur Häuser zum Kauf.
    if a["typ"] == "kauf" and a["preis"] and a["preis"] % 100 and re.search(r"haus", a["art"] or "", re.I):
        a["ausschluss"] = a["ausschluss"] or "Katalog-Neubau"
    # Ein Haus mit Grundstück hat einen Garten, auch wenn das Wort nicht fällt.
    # Immowelt schreibt das Grundstück als zweite Fläche: „4 Zimmer · 143 m² · 882 m²“.
    m = re.search(Z + r"\s*m²\s*Grundstück", t) or re.search(r"m²\s*·\s*" + Z + r"\s*m²", t)
    if m and (_zahl(m[1]) or 0) >= 150:
        a["garten"] = True
    if re.search(r"\bwarmmiete\b", t, re.I) and not re.search(r"\bkaltmiete\b", t, re.I):
        a["ausschluss"] = a["ausschluss"] or "nur Warmmiete genannt"
    return a


# ---------------------------------------------------------------- E-Mail


def _kopf(m: Message, k: str) -> str:
    return str(make_header(decode_header(m.get(k, ""))))


def _html_von(m: Message) -> str:
    teile = []
    for p in m.walk() if m.is_multipart() else [m]:
        if p.get_content_type() in ("text/html", "text/plain"):
            nutz = p.get_payload(decode=True) or b""
            t = nutz.decode(p.get_content_charset() or "utf-8", errors="replace")
            if p.get_content_type() == "text/html":
                teile.insert(0, t)
            else:
                teile.append(t)
    return teile[0] if teile else ""


def _block_text(a) -> str:
    """Geht vom Link nach oben, bis der Block Preis oder Fläche enthält."""
    knoten = a
    for _ in range(8):
        knoten = knoten.parent
        if knoten is None:
            break
        t = knoten.get_text(" | ", strip=True)
        if re.search(r"€|EUR", t) and re.search(r"m²|qm|m2|Zimmer", t):
            return t[:900]
    return a.get_text(" | ", strip=True)


def _karte(a) -> str | None:
    """Geht vom Link nach oben bis zur ganzen Angebotskarte: Preis, Zimmer und Ort."""
    knoten = a
    for _ in range(12):
        knoten = knoten.parent
        if knoten is None:
            return None
        t = knoten.get_text(" | ", strip=True)
        if "€" in t and re.search(r"Zimmer|Zi\.", t) and re.search(rf"\(\d{{5}}\)|,\s*(?:{STAEDTE})\b", t):
            return t[:900]
    return None


def lies_mail(roh: bytes) -> list[dict]:
    """Liefert alle Angebote einer Mail, je Inserat genau einmal.

    Immowelt-Angebote tragen danach noch einen Klick-Link (Feld „klick“), den `aufloesen`
    in die Inseratsnummer übersetzt.
    """
    m = email.message_from_bytes(roh)
    betreff = _kopf(m, "Subject")
    if re.search(r"alternative", betreff, re.I):
        return []  # Vorschläge außerhalb des Suchauftrags
    hinweis = _typ(betreff)
    haus = bool(re.search(r"\bHaus zu[mr]\b", betreff))
    wohnung = bool(re.search(r"wohnung", betreff, re.I))
    suppe = BeautifulSoup(_html_von(m), "html.parser")
    gesehen: dict[str, dict] = {}
    karten: dict[tuple, dict] = {}
    for a in suppe.find_all("a", href=True):
        # Zählpixel-Links tragen das Ziel oft nur URL-kodiert in sich.
        href = unquote(html.unescape(a["href"]))
        treffer = False
        for quelle, muster in LINKS:
            t = muster.search(href)
            if not t:
                continue
            treffer = True
            ext = t[1]
            schluessel = f"{quelle}:{ext}"
            block = _block_text(a)
            neu = lies_text(block, quelle, ext, typ=hinweis or _typ(block))
            alt = gesehen.get(schluessel)
            if alt is None or (neu["preis"] and not alt["preis"]):
                gesehen[schluessel] = neu
        if treffer or not KLICK.search(href):
            continue
        block = _karte(a)
        text = a.get_text(" ", strip=True)
        if not block or KEIN_INSERAT.search(text):
            continue
        # Mehrere Links gehören zu einer Karte; zusammengefasst wird über die Eckdaten.
        neu = lies_text(block, "immowelt", "x", typ=hinweis or _typ(block))
        eck = (neu["preis"], neu["flaeche"], neu["zimmer"], neu["plz"] or neu["stadtteil_text"])
        rang = 0 if re.search(r"mehr informationen", text, re.I) else 1 if text else 2
        karten.setdefault(eck, {"a": neu, "links": []})["links"].append((rang, href))
    for eck, k in karten.items():
        neu = k["a"]
        # Ersatznummer, falls die Weiterleitung nicht klappt: gleiche Eckdaten, gleiches Inserat.
        neu["id"] = "immowelt:k" + hashlib.sha1(repr(eck).encode()).hexdigest()[:12]
        neu["url"] = None
        neu["klick"] = [h for _, h in sorted(k["links"], key=lambda x: x[0])][:3]
        gesehen[neu["id"]] = neu
    for a in gesehen.values():
        if haus and a["art"] in (None, "Wohnung"):
            a["art"] = "Haus"
        elif wohnung and a["art"] in (None, "Haus", "Reihenhaus", "Doppelhaus", "Stadthaus"):
            a["art"] = "Wohnung"  # Der Suchauftrag gilt nur Wohnungen; „Haus“ stammt dann aus Titel oder Anbieter
    return list(gesehen.values())


class _OhneWeiterleitung(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def aufloesen(url: str, schritte: int = 4) -> str | None:
    """Folgt den Weiterleitungen eines Klick-Links, ohne die Zielseite zu laden; liefert die Inseratsnummer."""
    oeffner = urllib.request.build_opener(_OhneWeiterleitung)
    for _ in range(schritte):
        if m := EXPOSE_IW.search(url):
            return m[1]
        try:
            with oeffner.open(urllib.request.Request(url, headers=UA), timeout=20):
                return None  # keine Weiterleitung mehr, kein Inserat erkannt
        except urllib.error.HTTPError as e:
            ziel = e.headers.get("Location")
        except OSError:
            return None
        if not ziel:
            return None
        url = urllib.parse.urljoin(url, ziel)
    m = EXPOSE_IW.search(url)
    return m[1] if m else None
