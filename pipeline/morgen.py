"""Morgennachricht per WhatsApp: was gestern in den beiden Hamburger Lieblingsgebieten passiert ist.

    python pipeline/morgen.py                     schickt die Nachricht über gestern
    python pipeline/morgen.py --zeigen            zeigt sie nur an, schickt nichts
    python pipeline/morgen.py --tag 2026-11-09    berichtet über einen bestimmten Tag

Versand über CallMeBot (kostenlos, nur für private Nutzung). Jede Person holt sich dort einmal
einen eigenen Schlüssel. Die Empfänger stehen im GitHub Secret FZ_WHATSAPP, eine Zeile je Person:
    +491701234567 123456
Das Protokoll von GitHub Actions ist öffentlich: Es nennt keine Nummer und keinen Schlüssel.

Die Zahlen stammen aus dem Marktverlauf in data/wohnen.json (`verlauf`), also nur Angebote ab
der Mindestgröße. „Vom Markt“ heißt: ein Inserat wurde 45 Tage lang nicht mehr gemeldet. Die
Portale sagen nicht, wann eins wirklich verschwindet.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

WURZEL = Path(__file__).resolve().parent.parent
STAND = WURZEL / "data" / "wohnen.json"
GEBIETE_DATEI = WURZEL / "data" / "hamburg" / "gebiete.json"
GEBIETE = ("scheideweg", "eimsbuettel")
APP = "https://nikwall.github.io/vinifeli/#wohnen"
API = "https://api.callmebot.com/whatsapp.php"
ZIEL_STUNDE = 7  # Uhrzeit in Berlin, zu der die Nachricht kommen soll
BERLIN = ZoneInfo("Europe/Berlin")
WOCHENTAGE = ("Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag")


def ist_meine_stunde(zeitplan: str) -> bool:
    """GitHub kennt nur UTC. Zwei Zeitpläne (Sommer, Winter); nur der passende verschickt."""
    stunde_utc = int(zeitplan.split()[1])
    versatz = dt.datetime.now(BERLIN).utcoffset() // dt.timedelta(hours=1)
    return (stunde_utc + versatz) % 24 == ZIEL_STUNDE


def zeile(werte: dict, art: str) -> str:
    miete, kauf = werte["miete"][art], werte["kauf"][art]
    summe = miete + kauf
    if not summe:
        return "0"
    teile = [f"{miete} Miete" if miete else "", f"{kauf} Kauf" if kauf else ""]
    return f"{summe} ({', '.join(t for t in teile if t)})"


def nachricht(tag: dt.date) -> str:
    stand = json.loads(STAND.read_text(encoding="utf-8"))
    titel = {g["id"]: g["titel"] for g in json.loads(GEBIETE_DATEI.read_text(encoding="utf-8"))}
    kopf = f"Guten Morgen von vinifeli.\nGestern, {WOCHENTAGE[tag.weekday()]} {tag:%d.%m.}, in Hamburg:"
    tagesstand = stand.get("verlauf", {}).get(tag.isoformat())
    if not tagesstand:
        return f"{kopf}\n\nFür diesen Tag liegt kein Stand vor, der Abruf ist nicht gelaufen.\n\n{APP}"
    bloecke = []
    for g in GEBIETE:
        werte = tagesstand.get(g)
        if not werte:
            bloecke.append(f"*{titel.get(g, g)}*\nkeine Daten")
            continue
        bloecke.append(f"*{titel[g]}*\nneu: {zeile(werte, 'neu')}\nvom Markt: {zeile(werte, 'weg')}")
    return "\n\n".join([kopf, *bloecke, APP])


def empfaenger(roh: str) -> tuple[list[tuple[str, str]], int]:
    """Liest „Nummer Schlüssel“ je Zeile. Gibt die Empfänger und die Zahl unlesbarer Zeilen zurück."""
    aus, kaputt = [], 0
    for z in roh.splitlines():
        z = z.strip()
        if not z or z.startswith("#"):
            continue
        teile = re.split(r"[\s,;:]+", z)
        nummer = re.sub(r"[^\d+]", "", "".join(teile[:-1]))
        if nummer.startswith("00"):
            nummer = "+" + nummer[2:]
        schluessel = teile[-1]
        if re.fullmatch(r"\+\d{8,15}", nummer) and re.fullmatch(r"\w{3,64}", schluessel):
            aus.append((nummer, schluessel))
        else:
            kaputt += 1
    return aus, kaputt


def senden(nummer: str, schluessel: str, text: str) -> str | None:
    """Gibt None bei Erfolg zurück, sonst eine kurze Fehlerangabe ohne Nummer und Schlüssel."""
    url = API + "?" + urllib.parse.urlencode({"phone": nummer, "text": text, "apikey": schluessel})
    try:
        with urllib.request.urlopen(url, timeout=60) as antwort:
            koerper = antwort.read().decode("utf-8", "replace")
    except Exception as e:  # die Fehlermeldung könnte die Adresse samt Schlüssel enthalten
        return type(e).__name__
    klartext = re.sub(r"<[^>]+>", " ", koerper)
    if re.search(r"queued|sent\b", klartext, re.I) and not re.search(r"error|invalid", klartext, re.I):
        return None
    return "Antwort: " + re.sub(r"\d{3,}", "…", " ".join(klartext.split()))[:160]


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--zeigen", action="store_true")
    ap.add_argument("--tag")
    args = ap.parse_args()

    zeitplan = os.environ.get("ZEITPLAN", "").strip()
    if zeitplan and not ist_meine_stunde(zeitplan):
        print("Dieser Zeitplan gilt heute nicht (Sommer- oder Winterzeit).")
        return

    tag = dt.date.fromisoformat(args.tag) if args.tag else dt.datetime.now(BERLIN).date() - dt.timedelta(days=1)
    text = nachricht(tag)
    if args.zeigen:
        print(text)
        return

    liste, kaputt = empfaenger(os.environ.get("FZ_WHATSAPP", ""))
    if kaputt:
        print(f"{kaputt} Zeile(n) in FZ_WHATSAPP nicht lesbar. Format: +491701234567 123456")
    if not liste:
        print("Keine Empfänger eingerichtet, nichts verschickt.")
        sys.exit(1 if kaputt else 0)
    fehler = 0
    for i, (nummer, schluessel) in enumerate(liste, 1):
        if i > 1:
            time.sleep(3)
        problem = senden(nummer, schluessel, text)
        print(f"Empfänger {i}: {'verschickt' if problem is None else 'nicht verschickt, ' + problem}")
        fehler += problem is not None
    if fehler or kaputt:
        sys.exit(1)


if __name__ == "__main__":
    main()
