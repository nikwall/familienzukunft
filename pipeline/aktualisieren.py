"""Aktualisiert den Datenstand der App (data/wohnen.json, öffentlich lesbar).

    python pipeline/aktualisieren.py              Mails abholen, einlesen, anreichern
    python pipeline/aktualisieren.py --seed x.json  Angebote aus Datei übernehmen

Zugangsdaten zum Postfach kommen aus Umgebungsvariablen (GitHub Secrets):
    FZ_IMAP_HOST, FZ_IMAP_USER, FZ_IMAP_PASSWORT
"""
from __future__ import annotations

import argparse
import datetime as dt
import email
import hashlib
import imaplib
import json
import os
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parent))
from anreichern import ORTE, anreichern  # noqa: E402
from lesen import URL, aufloesen, lies_mail  # noqa: E402
from verlauf import tagesstand  # noqa: E402

WURZEL = Path(__file__).resolve().parent.parent
STAND = WURZEL / "data" / "wohnen.json"
START = WURZEL / ".geheim" / "einstellungen.json"
PFLICHT = ("typ", "preis", "flaeche")
INSERAT_GILT_TAGE = 45  # ohne neuen Hinweis gilt ein Inserat danach als weg
ZIMMER_HOECHSTENS = 12  # darüber sind es praktisch nur Zinshäuser
LESER = 2  # Version des Einlesens: Steigt sie, werden Mails ohne Treffer noch einmal gelesen
MAILS_TAGE = 14  # so weit zurück schaut jeder Lauf ins Postfach


def heute_datum() -> dt.date:
    return dt.datetime.now(ZoneInfo("Europe/Berlin")).date()


def heute() -> str:
    return heute_datum().isoformat()


def stand_laden() -> dict:
    if STAND.exists():
        return json.loads(STAND.read_text(encoding="utf-8"))
    einst = json.loads(START.read_text(encoding="utf-8")) if START.exists() else {}
    return {"einstellungen": einst, "angebote": {}, "geocache": {}, "verworfen": {}}


def inhalt(stand: dict) -> str:
    return json.dumps({k: v for k, v in stand.items() if k != "aktualisiert"}, sort_keys=True, ensure_ascii=False)


def stand_sichern(stand: dict, vorher: str) -> None:
    """Schreibt nur bei echter Änderung, sonst entstünde bei jedem Lauf ein neuer Commit."""
    if STAND.exists() and inhalt(stand) == vorher:
        print("Keine Änderung.")
        return
    stand["aktualisiert"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes")
    STAND.write_text(json.dumps(stand, ensure_ascii=False, indent=1), encoding="utf-8")


def absender_domain(roh: bytes) -> str:
    m = re.search(r"@([\w.-]+)", email.message_from_bytes(roh).get("From", ""))
    return m[1].lower() if m else "unbekannt"


def mails_abholen(stand: dict) -> list[dict]:
    """Holt die Mails der letzten zwei Wochen, jede nur einmal.

    Das Postfach wird nur gelesen, nie verändert: Ihr dürft die Mails selbst öffnen.
    Welche Mail schon verarbeitet ist, steht als Prüfsumme ihrer Message-ID in `stand["mails"]`.
    Mails ohne erkanntes Angebot kommen wieder dran, sobald das Einlesen verbessert wurde (LESER).
    Das Protokoll ist öffentlich, es nennt nur Absender-Domain und Zahlen.
    """
    host, nutzer, pw = (os.environ.get(k, "") for k in ("FZ_IMAP_HOST", "FZ_IMAP_USER", "FZ_IMAP_PASSWORT"))
    if not (host and nutzer and pw):
        print("Kein Postfach eingerichtet, überspringe Mails.")
        return []
    erledigt = stand.setdefault("mails", {})
    aus: list[dict] = []
    seit = (heute_datum() - dt.timedelta(days=MAILS_TAGE)).strftime("%d-%b-%Y")
    with imaplib.IMAP4_SSL(host) as imap:
        imap.login(nutzer, pw)
        imap.select("INBOX", readonly=True)
        _, ids = imap.search(None, f'(SINCE "{seit}")')
        for i in ids[0].split():
            _, kopf = imap.fetch(i, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
            mid = (kopf[0][1] or b"").decode(errors="replace").split(":", 1)[-1].strip() or i.decode()
            schluessel = hashlib.sha1(mid.encode()).hexdigest()[:16]
            alt = erledigt.get(schluessel)
            if alt and (alt[1] > 0 or alt[2] >= LESER):
                continue
            _, teile = imap.fetch(i, "(BODY.PEEK[])")
            roh = teile[0][1]
            angebote = lies_mail(roh)
            for a in angebote:
                # Klick-Links tragen ein Merkmal des Postfachs; öffentlich gespeichert wird nur die Inseratsadresse.
                for klick in a.pop("klick", []):
                    if nummer := aufloesen(klick):
                        a["id"], a["url"] = f"immowelt:{nummer}", URL["immowelt"].format(nummer)
                        break
            print(f"Mail von {absender_domain(roh)}: {len(angebote)} Angebot(e)")
            erledigt[schluessel] = [heute(), len(angebote), LESER]
            aus += angebote
    grenze = (heute_datum() - dt.timedelta(days=30)).isoformat()
    for k in [k for k, v in erledigt.items() if v[0] < grenze]:
        del erledigt[k]
    if aus:
        stand["letzte_mail"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes")
    return aus


def einordnen(stand: dict, neu: list[dict], quelle: str) -> tuple[int, dict]:
    """Übernimmt neue Inserate; zählt, was warum nicht aufgenommen wurde."""
    tag, zaehler, neu_n = heute(), {}, 0
    for a in neu:
        grund = a.get("ausschluss")
        if not grund and a.get("ort") not in ORTE:
            grund = "außerhalb der Suchgebiete"
        if not grund and not all(a.get(k) for k in PFLICHT):
            grund = "unvollständig"
        if not grund and (a.get("zimmer") or 0) >= ZIMMER_HOECHSTENS:
            grund = "zu groß"
        if grund:
            zaehler[grund] = zaehler.get(grund, 0) + 1
            stand["verworfen"][a["id"]] = {"grund": grund, "tag": tag, "url": a["url"]}
            continue
        alt = stand["angebote"].get(a["id"])
        if alt:
            # bereits bekannt: nur fehlende Angaben ergänzen, Preisänderungen notieren
            if a["preis"] != alt["preis"]:
                alt.setdefault("preis_verlauf", []).append([tag, alt["preis"]])
                alt["preis"] = a["preis"]
            for k, v in a.items():
                if v is not None and alt.get(k) is None:
                    alt[k] = v
            alt["zuletzt"] = tag
            continue
        a["erstmals"] = a["zuletzt"] = tag
        anreichern(a, stand["geocache"])
        stand["angebote"][a["id"]] = a
        neu_n += 1
    print(f"{quelle}: {neu_n} neu, ausgelassen: {zaehler or 'nichts'}")
    return neu_n, zaehler


def ablauf(stand: dict) -> None:
    tag = heute_datum()
    grenze = (tag - dt.timedelta(days=INSERAT_GILT_TAGE)).isoformat()
    for a in stand["angebote"].values():
        war_aktiv = a.get("aktiv", True)
        a["aktiv"] = a["zuletzt"] >= grenze
        if war_aktiv and not a["aktiv"]:
            a["weg_am"] = tag.isoformat()
        elif a["aktiv"]:
            a.pop("weg_am", None)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed")
    args = ap.parse_args()
    stand = stand_laden()
    vorher = inhalt(stand)
    if args.seed:
        einordnen(stand, json.loads(Path(args.seed).read_text(encoding="utf-8")), "Datei")
    else:
        einordnen(stand, mails_abholen(stand), "Mails")
    ablauf(stand)
    einst = stand["einstellungen"]
    stand.setdefault("verlauf", {})[heute()] = tagesstand(stand["angebote"], heute(), einst["muss"], einst.get("bestand_bis"))
    stand_sichern(stand, vorher)
    print(f"Stand: {sum(1 for a in stand['angebote'].values() if a['aktiv'])} aktive Angebote.")


if __name__ == "__main__":
    main()
