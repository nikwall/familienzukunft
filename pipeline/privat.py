"""Privater Bereich der App: sammelt Stellenanzeigen und speichert sie verschlüsselt.

Die Datei data/privat.enc.json ist öffentlich abrufbar, aber mit AES-GCM verschlüsselt.
Schlüssel und Suchprofil kommen aus GitHub-Secrets:
    PRIVAT_SCHLUESSEL   32 Byte, base64url
    PRIVAT_PROFIL       JSON mit Suchwörtern, Ausschlüssen und Suchaufträgen
Das öffentliche Protokoll nennt bewusst keine Inhalte, nur ob sich etwas geändert hat.

Quellen
- Jobsuche-API der Bundesagentur für Arbeit (öffentlicher Schlüssel „jobboerse-jobsuche“)
- RSS-Feed von service.bund.de (öffentliche Verwaltung)
- Alert-Mails der Jobportale im Familienpostfach (nur deren Links und Kurztexte)
"""
from __future__ import annotations

import base64
import datetime as dt
import email
import hashlib
import html
import json
import math
import os
import re
import time
import urllib.parse
import urllib.request
from email.header import decode_header, make_header
from pathlib import Path
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

DATEI = Path(__file__).resolve().parent.parent / "data" / "privat.enc.json"
UA = {"User-Agent": "Mozilla/5.0 (vinifeli; private Abfrage, geringe Menge)"}
BA = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service"
BA_KOPF = {**UA, "X-API-Key": "jobboerse-jobsuche"}
BUND_RSS = "https://www.service.bund.de/SiteGlobals/Functions/RSSFeed/RSSGenerator_Stellen.xml"
HAMBURG = (53.5511, 9.9937)
BA_ALLE_STUNDEN = 4
GILT_TAGE = 45
LESER = 1  # Version des Mail-Lesers; steigt sie, kommen Mails ohne Treffer noch einmal dran
_letzte_anfrage = 0.0

# Links in Alert-Mails, die auf genau eine Stelle zeigen
MAIL_LINKS = [
    ("LinkedIn", re.compile(r"linkedin\.com/(?:comm/)?jobs/view/(\d+)")),
    ("StepStone", re.compile(r"stepstone\.de/stellenangebote--[^\s\"'?#]*?-(\d{6,})-inline\.html")),
    ("Interamt", re.compile(r"interamt\.de/koop/app/stelle\?(?:[^\"'\s]*&)?id=(\d+)")),
    ("academics", re.compile(r"academics\.(?:de|com)/jobs/[^\s\"'?#]*?(\d{5,})")),
    ("Indeed", re.compile(r"indeed\.[a-z.]+/(?:rc/clk|viewjob|pagead/clk)\?[^\"'\s]*?jk=([0-9a-f]{10,})")),
    ("XING", re.compile(r"xing\.com/jobs/[^\s\"'?#]*?-(\d{6,})")),
]
ABSENDER = re.compile(r"linkedin\.com|stepstone\.de|interamt\.de|academics\.(?:de|com)|indeed\.|xing\.com|bundesbank\.de|"
                      r"myworkdayjobs\.com|successfactors|lufthansa|airbus|google\.com|ecb\.europa\.eu", re.I)

REMOTE_VOLL = re.compile(r"100\s*%\s*(?:remote|mobil|home)|vollständig (?:remote|mobil)|komplett (?:remote|mobil)|fully[ -]remote|"
                         r"full[ -]remote|remote[ -]first|ortsunabhängig|deutschlandweit (?:remote|mobil)|bundesweit (?:remote|mobil)|"
                         r"work from anywhere|remote \(?(?:deutschland|germany|europe|eu)\)", re.I)
HYBRID = re.compile(r"hybrid|mobiles arbeiten|mobile arbeit|homeoffice|home-office|home office|remote|telearbeit", re.I)
TEILZEIT = re.compile(r"teilzeit|part[- ]time|\b(?:20|25|30|32)\s*(?:std|stunden|h)\b|teilzeitfähig|reduzierte arbeitszeit", re.I)
EINSTIEG = re.compile(r"junior|berufseinsteig|absolvent|graduate|einstiegs", re.I)
KUNDE = re.compile(r"beim kunden vor ort|kundeneinsatz|vor ort bei (?:unseren|den) kunden|on[- ]site at client", re.I)
REISEN = re.compile(r"reisebereitschaft|reisetätigkeit|travel (?:up to|required)", re.I)
FORSCHUNG = re.compile(r"wissenschaftl|research|forsch", re.I)
OEKONOMIE = re.compile(r"volkswirt|ökonom|oekonom|econom", re.I)
LEITUNG = re.compile(r"leitung|leiter|lead\b|head of|teamlead", re.I)


def heute() -> str:
    return dt.datetime.now(ZoneInfo("Europe/Berlin")).date().isoformat()


# ---------------------------------------------------------------- Verschlüsselung


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def laden(schluessel: bytes) -> dict:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if not DATEI.exists():
        return {}
    d = json.loads(DATEI.read_text(encoding="utf-8"))
    return json.loads(AESGCM(schluessel).decrypt(_unb64(d["iv"]), _unb64(d["ct"]), None))


def sichern(stand: dict, schluessel: bytes) -> None:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv = os.urandom(12)
    ct = AESGCM(schluessel).encrypt(iv, json.dumps(stand, ensure_ascii=False, separators=(",", ":")).encode(), None)
    DATEI.write_text(json.dumps({"v": 1, "iv": _b64(iv), "ct": _b64(ct)}), encoding="utf-8")


# ---------------------------------------------------------------- Hilfen


def holen(url: str, kopf: dict = UA, zeit: int = 40) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=kopf), timeout=zeit) as r:
        return r.read()


def abstand_km(a, b, c, d) -> float:
    r = math.radians
    x = r(d - b) * math.cos(r((a + c) / 2))
    return 6371 * math.hypot(x, r(c - a))


def verorten(ort: str, geo: dict) -> list | None:
    """Koordinaten zu „PLZ Ort“ über Nominatim, mit Zwischenspeicher."""
    global _letzte_anfrage
    ort = re.sub(r"\s+", " ", ort or "").strip()
    if not ort:
        return None
    if ort in geo:
        return geo[ort]
    warte = 1.1 - (time.time() - _letzte_anfrage)
    if warte > 0:
        time.sleep(warte)
    _letzte_anfrage = time.time()
    try:
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
            {"q": ort, "format": "jsonv2", "limit": 1, "countrycodes": "de,at,ch,nl,dk,be,lu,fr,gb,ie"})
        d = json.loads(holen(url, {"User-Agent": "vinifeli/0.2 (private Familien-App)"}))
        geo[ort] = [round(float(d[0]["lat"]), 4), round(float(d[0]["lon"]), 4)] if d else None
    except OSError:
        return None
    return geo[ort]


def nur_text(h: str) -> str:
    h = re.sub(r"<(script|style|noscript|nav|header|footer)\b.*?</\1>", " ", h, flags=re.S | re.I)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h))).strip()


# ---------------------------------------------------------------- Quellen


def bundesagentur(profil: dict, seit_tage: int) -> list[dict]:
    aus: dict[str, dict] = {}
    for suche in profil.get("ba_suchen", []):
        q = {"size": 100, "veroeffentlichtseit": seit_tage, **suche}
        try:
            d = json.loads(holen(f"{BA}/pc/v6/jobs?" + urllib.parse.urlencode(q), BA_KOPF))
        except (OSError, ValueError):
            continue
        for x in d.get("ergebnisliste") or []:
            ref = x.get("referenznummer")
            if not ref or ref in aus:
                continue
            orte = [{"ort": (l.get("adresse") or {}).get("ort"), "plz": (l.get("adresse") or {}).get("plz"),
                     "geo": [l["breite"], l["laenge"]] if l.get("breite") else None} for l in x.get("stellenlokationen") or []]
            aus[ref] = {
                "id": f"ba:{ref}", "quelle": "Bundesagentur", "titel": x.get("stellenangebotsTitel") or "",
                "firma": x.get("firma"), "orte": orte,
                "teilzeit": any(x.get(k) for k in ("arbeitszeitTeilzeitFlexibel", "arbeitszeitTeilzeitVormittag",
                                                   "arbeitszeitTeilzeitNachmittag", "arbeitszeitTeilzeitAbend")),
                "vollzeit": bool(x.get("arbeitszeitVollzeit")), "homeoffice": bool(x.get("homeofficemoeglich")),
                "befristet": x.get("vertragsdauer") not in (None, "UNBEFRISTET"),
                "datum": x.get("datumErsteVeroeffentlichung"),
                "url": f"https://www.arbeitsagentur.de/jobsuche/jobdetail/{ref}",
                "_ref": ref,
            }
        time.sleep(0.3)
    return list(aus.values())


def ba_text(ref: str) -> str:
    try:
        d = json.loads(holen(f"{BA}/pc/v4/jobdetails/{base64.b64encode(ref.encode()).decode()}", BA_KOPF))
    except (OSError, ValueError):
        return ""
    return d.get("stellenangebotsBeschreibung") or ""


def bund() -> list[dict]:
    try:
        t = holen(BUND_RSS).decode("utf-8", "replace")
    except OSError:
        return []
    aus = []
    for it in re.findall(r"<item>(.*?)</item>", t, re.S):
        feld = lambda n: html.unescape((re.search(rf"<{n}>(.*?)</{n}>", it, re.S) or [None, ""])[1]).strip()  # noqa: E731
        beschr = html.unescape(re.sub(r"<!\[CDATA\[|\]\]>", "", feld("description")))
        link = feld("link").split("#")[0]
        nummer = re.search(r"/(\d+)\.html", link)
        if not nummer:
            continue
        firma = re.search(r"Arbeitgeber:\s*<strong>(.*?)</strong>", beschr)
        ort = re.search(r"Ort:\s*<strong>(.*?)</strong>", beschr)
        frist = re.search(r"Veröffentlichungsende:\s*<strong>(\d{2})\.(\d{2})\.(\d{4})", beschr)
        try:
            datum = dt.datetime.strptime(feld("pubDate")[:16], "%a, %d %b %Y").date().isoformat()
        except ValueError:
            datum = heute()
        aus.append({
            "id": f"bund:{nummer[1]}", "quelle": "service.bund.de", "titel": feld("title"),
            "firma": html.unescape(firma[1]) if firma else None,
            "orte": [{"ort": html.unescape(ort[1]) if ort else None}], "datum": datum,
            "frist": f"{frist[3]}-{frist[2]}-{frist[1]}" if frist else None, "url": link,
        })
    return aus


def ist_privat_mail(roh: bytes) -> bool:
    """Gehört die Mail in den privaten Bereich? Erkennt Alert-Mails an Absender und Stellenlinks."""
    m = email.message_from_bytes(roh)
    if ABSENDER.search(m.get("From", "")):
        return True
    t = urllib.parse.unquote(roh.decode("utf-8", "replace"))
    return any(muster.search(t) for _, muster in MAIL_LINKS)


def _kopf(m, k: str) -> str:
    try:
        return str(make_header(decode_header(m.get(k, ""))))
    except Exception:
        return m.get(k, "")


def _html(m) -> str:
    for p in m.walk() if m.is_multipart() else [m]:
        if p.get_content_type() == "text/html":
            return (p.get_payload(decode=True) or b"").decode(p.get_content_charset() or "utf-8", "replace")
    for p in m.walk() if m.is_multipart() else [m]:
        if p.get_content_type() == "text/plain":
            t = (p.get_payload(decode=True) or b"").decode(p.get_content_charset() or "utf-8", "replace")
            return re.sub(r"(https?://\S+)", r'<a href="\1">\1</a>', html.escape(t)).replace("\n", "<br>")
    return ""


def lies_alert(roh: bytes) -> list[dict]:
    """Stellen aus einer Alert-Mail: Titel aus dem Linktext, Firma und Ort aus dem Block darum."""
    m = email.message_from_bytes(roh)
    suppe = BeautifulSoup(_html(m), "html.parser")
    gesehen: dict[str, dict] = {}
    for a in suppe.find_all("a", href=True):
        href = urllib.parse.unquote(html.unescape(a["href"]))
        for quelle, muster in MAIL_LINKS:
            t = muster.search(href)
            if not t:
                continue
            schluessel = f"{quelle.lower()}:{t[1]}"
            text = a.get_text(" ", strip=True)
            block = a
            for _ in range(6):
                if block.parent is None:
                    break
                block = block.parent
                zeilen = [z for z in block.get_text("\n", strip=True).split("\n") if z.strip()]
                if len(zeilen) >= 3:
                    break
            zeilen = [re.sub(r"\s+", " ", z).strip() for z in block.get_text("\n", strip=True).split("\n") if z.strip()]
            titel = text if 6 <= len(text) <= 160 else next((z for z in zeilen if 6 <= len(z) <= 160), "")
            rest = [z for z in zeilen if z != titel][:4]
            alt = gesehen.get(schluessel)
            if alt and len(alt["titel"]) >= len(titel):
                continue
            url = re.sub(r"[?&](?:utm_[^&]+|trk[^&]*|refId=[^&]+|trackingId=[^&]+)", "", href.split("#")[0])
            gesehen[schluessel] = {
                "id": schluessel, "quelle": quelle, "titel": titel, "firma": rest[0] if rest else None,
                "orte": [{"ort": rest[1]}] if len(rest) > 1 else [], "datum": heute(), "url": url,
                "text": " ".join(zeilen)[:600],
            }
    return [g for g in gesehen.values() if g["titel"]]


# ---------------------------------------------------------------- Bewertung


def einordnen(j: dict, profil: dict, geo: dict) -> None:
    """Setzt Lage, Ausschluss, Stärken, Schwächen und Punkte. Alles regelbasiert."""
    titel, text = j.get("titel") or "", j.get("text") or ""
    alles = f"{titel} {text}"
    nicht = re.compile(profil["nicht"], re.I)
    oekon = re.compile(profil.get("oekon_text", "volkswirt|ökonom|econom"), re.I)
    j["raus"] = None
    if nicht.search(titel):
        j["raus"] = "Bereich passt nicht"
    elif j.get("firma") and re.search(profil.get("firma_nicht", "^$"), j["firma"], re.I):
        j["raus"] = "Arbeitgeber passt nicht"
    elif not (re.search(profil["rolle"], titel, re.I) and (re.search(profil["fach"], titel, re.I) or oekon.search(text))):
        # Ohne Fach im Titel muss der Text klar ökonomisch oder empirisch sein.
        j["raus"] = "Rolle passt nicht"
    # Lage: nächster Ort zu Hamburg
    km, ortname = None, None
    for o in j.get("orte") or []:
        g = o.get("geo") or (verorten(" ".join(filter(None, [o.get("plz"), o.get("ort")])), geo) if o.get("ort") else None)
        if g:
            d = abstand_km(*HAMBURG, *g)
            if km is None or d < km:
                km, ortname = d, o.get("ort")
    remote_voll = bool(REMOTE_VOLL.search(alles))
    hybrid = j.get("homeoffice") or bool(HYBRID.search(alles))
    if km is not None and km <= 35:
        j["lage"] = "Hamburg"
    elif remote_voll:
        j["lage"] = "Remote"
    elif km is not None and km <= 110:
        j["lage"] = f"{ortname} (pendeln)" if hybrid else f"{ortname} (vor Ort)"
    elif ortname and "berlin" in ortname.lower() and hybrid:
        j["lage"] = "Berlin (hybrid)"
    elif km is None and not j.get("orte"):
        j["lage"] = "Ort unklar"
    else:
        j["lage"] = ortname or "anderswo"
        j["raus"] = j["raus"] or "Ort nicht erreichbar"
    j["km"] = round(km) if km is not None else None

    plus, minus = [], []
    teilzeit = j.get("teilzeit") or bool(TEILZEIT.search(alles))
    if teilzeit:
        plus.append(("Teilzeit möglich", 50))
    elif j.get("vollzeit"):
        minus.append(("Nur Vollzeit", 30))
    if j["lage"] == "Remote":
        plus.append(("Komplett remote", 45))
    elif j["lage"] == "Hamburg":
        plus.append(("In Hamburg" + (", hybrid" if hybrid else ""), 35 if hybrid else 25))
    elif "(pendeln)" in j["lage"]:
        minus.append((f"Pendeln nach {ortname} ({j['km']} km)", 20))
    elif "(vor Ort)" in j["lage"]:
        minus.append((f"Täglich vor Ort in {ortname} ({j['km']} km)", 55))
    elif j["lage"].startswith("Berlin"):
        minus.append(("Berlin, nur mit wenig Präsenz machbar", 35))
    if FORSCHUNG.search(titel):
        plus.append(("Forschungsstelle", 40))
    if OEKONOMIE.search(titel):
        plus.append(("Ökonomische Stelle", 60))
    elif oekon.search(text):
        plus.append(("Ökonomie im Aufgabenprofil", 30))
    elif re.search(r"analyst|analys", titel, re.I):
        plus.append(("Analysestelle", 25))
    elif re.search(r"referent", titel, re.I):
        plus.append(("Referentenstelle", 25))
    if LEITUNG.search(titel):
        plus.append(("Mit Leitung", 15))
    if j.get("firma") and re.search(profil.get("arbeitgeber_plus", "^$"), j["firma"], re.I):
        plus.append(("Arbeitgeber aus deiner Liste", 20))
    if j.get("befristet") is False:
        plus.append(("Unbefristet", 15))
    elif j.get("befristet"):
        minus.append(("Befristet", 10))
    if EINSTIEG.search(titel):
        minus.append(("Einstiegsstelle", 35))
    if KUNDE.search(alles):
        minus.append(("Einsatz beim Kunden", 45))
    if REISEN.search(alles):
        minus.append(("Viel Reisen", 15))
    plus.sort(key=lambda x: -x[1])
    minus.sort(key=lambda x: -x[1])
    j["plus"] = [p[0] for p in plus]
    j["minus"] = [m[0] for m in minus]
    j["punkte"] = sum(p[1] for p in plus) - sum(m[1] for m in minus)
    j["teilzeit"] = teilzeit
    j["hybrid"] = bool(hybrid)


# ---------------------------------------------------------------- Lauf


def bekannte_mails() -> set[str]:
    """Prüfsummen der Alert-Mails, die nicht noch einmal gelesen werden müssen."""
    schl = os.environ.get("PRIVAT_SCHLUESSEL", "")
    if not schl:
        return set()
    try:
        erledigt = laden(_unb64(schl)).get("mails", {})
    except Exception:
        return set()
    return {k for k, v in erledigt.items() if v[1] > 0 or v[2] >= LESER}


def lauf(mails: list[tuple[str, bytes]], jetzt: dt.datetime | None = None) -> None:
    """mails: (Prüfsumme der Message-ID, Rohmail) der Alert-Mails dieses Laufs."""
    schl, prof = os.environ.get("PRIVAT_SCHLUESSEL", ""), os.environ.get("PRIVAT_PROFIL", "")
    if not (schl and prof):
        print("Privater Bereich: nicht eingerichtet.")
        return
    schluessel, profil = _unb64(schl), json.loads(prof)
    stand = laden(schluessel)
    vorher = json.dumps({k: v for k, v in stand.items() if k != "stand"}, sort_keys=True, ensure_ascii=False)
    stand.setdefault("jobs", {})
    geo = stand.setdefault("geo", {})
    erledigt = stand.setdefault("mails", {})
    jetzt = jetzt or dt.datetime.now(dt.timezone.utc)
    tag = heute()

    neu: list[dict] = []
    letzter = stand.get("ba_letzter")
    if not letzter or (jetzt - dt.datetime.fromisoformat(letzter)).total_seconds() > BA_ALLE_STUNDEN * 3600:
        neu += bundesagentur(profil, 30 if not letzter else 7)
        stand["ba_letzter"] = jetzt.isoformat(timespec="minutes")
    for j in bund():
        if j["id"] in stand["jobs"] or re.search(profil["nicht"], j["titel"], re.I) or not re.search(profil["rolle"], j["titel"], re.I):
            neu.append(j)
            continue
        try:
            j["text"] = nur_text(holen(j["url"]).decode("utf-8", "replace"))[:6000]
        except OSError:
            j["text"] = ""
        neu.append(j)
    for schluessel_mail, roh in mails:
        alt = erledigt.get(schluessel_mail)
        if alt and (alt[1] > 0 or alt[2] >= LESER):
            continue
        treffer = lies_alert(roh)
        erledigt[schluessel_mail] = [tag, len(treffer), LESER]
        neu += treffer

    for j in neu:
        alt = stand["jobs"].get(j["id"])
        if alt:
            alt["zuletzt"] = tag
            continue
        # Vorfilter am Titel, bevor Text und Ort nachgeladen werden
        if re.search(profil["nicht"], j["titel"], re.I) or not re.search(profil["rolle"], j["titel"], re.I):
            continue
        ref = j.pop("_ref", None)
        if ref and "text" not in j:
            j["text"] = ba_text(ref)[:6000]
        einordnen(j, profil, geo)
        j["text"] = (j.get("text") or "")[:1200] if not j["raus"] else ""
        j["erstmals"] = j["zuletzt"] = tag
        stand["jobs"][j["id"]] = j

    # Jede Runde neu bewerten, damit Änderungen am Profil auch für Bekanntes gelten.
    for j in stand["jobs"].values():
        j.pop("_ref", None)
        if j.get("text") or not j.get("raus"):
            einordnen(j, profil, geo)

    grenze = (dt.date.fromisoformat(tag) - dt.timedelta(days=GILT_TAGE)).isoformat()
    for j in stand["jobs"].values():
        j["aktiv"] = j["zuletzt"] >= grenze and (not j.get("frist") or j["frist"] >= tag)
    for k in [k for k, v in erledigt.items() if v[0] < grenze]:
        del erledigt[k]
    stand["titel"] = profil.get("titel", "Privat")
    if json.dumps({k: v for k, v in stand.items() if k != "stand"}, sort_keys=True, ensure_ascii=False) == vorher:
        print("Privater Bereich: unverändert.")
        return
    stand["stand"] = jetzt.isoformat(timespec="minutes")
    sichern(stand, schluessel)
    print("Privater Bereich: aktualisiert.")
