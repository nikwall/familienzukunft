"""Liest Angebote aus Portal-E-Mails (Suchaufträge) und aus Kartentext.

Regelbasiert und bewusst tolerant: Portale ändern ihre Mails. Was nicht sicher
erkannt wird, bleibt leer, und wird nicht geraten. Namen von Anbietern werden
nicht übernommen.
"""
from __future__ import annotations

import email
import html
import re
from email.header import decode_header, make_header
from email.message import Message
from urllib.parse import unquote

from bs4 import BeautifulSoup

LINKS = [
    ("immoscout24", re.compile(r"immobilienscout24\.de/expose/(\d+)")),
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
    if m:
        preis, qm_preis = _zahl(m[1]), _zahl(m[2])
    else:
        for m in re.finditer(Z + r"\s*(?:€|EUR|Euro)(?!/m)", t):
            w = _zahl(m[1])
            if w and w >= 100:
                preis = w
                break

    m = re.search(Z + r"\s*(?:m²|qm|m2)\b", t)
    flaeche = _zahl(m[1]) if m else None
    m = re.search(r"(\d+(?:,\d)?)\s*(?:Zimmer|Zi\.?\b|-Zimmer)", t)
    zimmer = _zahl(m[1]) if m else None

    art = next((v for k, v in ART.items() if re.search(rf"\b{k}", t, re.I)), None)
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
        "garten": True if re.search(r"(?<![a-zäöü-])(?:garten|gartenanteil)(?![a-zäöü])", t, re.I) else None,
        "ausschluss": grund,
        **_ort(t),
    }
    if qm_preis and flaeche and not preis:
        a["preis"] = qm_preis * flaeche
    # Ein Haus mit Grundstück hat einen Garten, auch wenn das Wort nicht fällt.
    m = re.search(Z + r"\s*m²\s*Grundstück", t)
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


def lies_mail(roh: bytes) -> list[dict]:
    """Liefert alle Angebote einer Mail, je Link genau einmal."""
    m = email.message_from_bytes(roh)
    betreff = _kopf(m, "Subject")
    h = _html_von(m)
    suppe = BeautifulSoup(h, "html.parser")
    gesehen: dict[str, dict] = {}
    for a in suppe.find_all("a", href=True):
        # Zählpixel-Links tragen das Ziel oft nur URL-kodiert in sich.
        href = unquote(html.unescape(a["href"]))
        for quelle, muster in LINKS:
            t = muster.search(href)
            if not t:
                continue
            ext = t[1]
            schluessel = f"{quelle}:{ext}"
            block = _block_text(a)
            neu = lies_text(block, quelle, ext, typ=_typ(betreff) or _typ(block))
            alt = gesehen.get(schluessel)
            if alt is None or (neu["preis"] and not alt["preis"]):
                gesehen[schluessel] = neu
    return list(gesehen.values())
