"""Aktualisiert den Datenstand der App (data/wohnen.json, öffentlich lesbar).

    python pipeline/aktualisieren.py              Mails abholen, einlesen, anreichern
    python pipeline/aktualisieren.py --seed x.json  Angebote aus Datei übernehmen

Zugangsdaten zum Postfach kommen aus Umgebungsvariablen (GitHub Secrets):
    FZ_IMAP_HOST, FZ_IMAP_USER, FZ_IMAP_PASSWORT
"""
from __future__ import annotations

import argparse
import datetime as dt
import imaplib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from anreichern import anreichern  # noqa: E402
from lesen import lies_mail  # noqa: E402

WURZEL = Path(__file__).resolve().parent.parent
STAND = WURZEL / "data" / "wohnen.json"
START = WURZEL / ".geheim" / "einstellungen.json"
PFLICHT = ("typ", "preis", "flaeche")
INSERAT_GILT_TAGE = 45  # ohne neuen Hinweis gilt ein Inserat danach als weg


def heute() -> str:
    return dt.date.today().isoformat()


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


def mails_abholen() -> list[bytes]:
    host, nutzer, pw = (os.environ.get(k, "") for k in ("FZ_IMAP_HOST", "FZ_IMAP_USER", "FZ_IMAP_PASSWORT"))
    if not (host and nutzer and pw):
        print("Kein Postfach eingerichtet, überspringe Mails.")
        return []
    aus = []
    with imaplib.IMAP4_SSL(host) as imap:
        imap.login(nutzer, pw)
        imap.select("INBOX")
        _, ids = imap.search(None, "UNSEEN")
        for i in ids[0].split():
            _, teile = imap.fetch(i, "(RFC822)")  # setzt die Mail auf gelesen
            aus.append(teile[0][1])
    print(f"{len(aus)} neue Mail(s).")
    return aus


def einordnen(stand: dict, neu: list[dict], quelle: str) -> tuple[int, dict]:
    """Übernimmt neue Inserate; zählt, was warum nicht aufgenommen wurde."""
    tag, zaehler, neu_n = heute(), {}, 0
    for a in neu:
        grund = a.get("ausschluss")
        if not grund and a.get("ort") != "Hamburg":
            grund = "außerhalb Hamburgs"
        if not grund and not all(a.get(k) for k in PFLICHT):
            grund = "unvollständig"
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
    grenze = (dt.date.today() - dt.timedelta(days=INSERAT_GILT_TAGE)).isoformat()
    for a in stand["angebote"].values():
        a["aktiv"] = a["zuletzt"] >= grenze


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
        neu = [a for m in mails_abholen() for a in lies_mail(m)]
        einordnen(stand, neu, "Mails")
    ablauf(stand)
    stand_sichern(stand, vorher)
    print(f"Stand: {sum(1 for a in stand['angebote'].values() if a['aktiv'])} aktive Angebote.")


if __name__ == "__main__":
    main()
