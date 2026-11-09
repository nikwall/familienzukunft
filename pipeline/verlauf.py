"""Hält den Marktverlauf fest: je Tag, Gebiet und Art die Zahl der Angebote und den Preis.

Ein Tagesstand wird nicht nachträglich neu berechnet. Spätere Läufe am selben Tag
überschreiben nur den Eintrag dieses Tages.
"""
from __future__ import annotations

import json
import statistics
from pathlib import Path

DATEN = Path(__file__).resolve().parent.parent / "data"
STAEDTE = json.loads((DATEN / "staedte.json").read_text(encoding="utf-8"))


def _gebiete(stadt_id: str) -> list:
    return json.loads((DATEN / stadt_id / "gebiete.json").read_text(encoding="utf-8"))


def _preisaenderungen(a: dict, tag: str) -> tuple[int, int]:
    """Zählt Senkungen und Erhöhungen dieses Inserats an diesem Tag."""
    runter = hoch = 0
    verlauf = a.get("preis_verlauf") or []
    for i, (t, alt) in enumerate(verlauf):
        if t != tag:
            continue
        neu = verlauf[i + 1][1] if i + 1 < len(verlauf) else a["preis"]
        runter += neu < alt
        hoch += neu > alt
    return runter, hoch


def tagesstand(angebote: dict, tag: str, muss: dict) -> dict:
    aus = {}
    for s in STAEDTE:
        alle = [a for a in angebote.values() if a.get("ort") == s["name"] and a["flaeche"] >= muss["flaeche"] and (a.get("zimmer") or 99) >= muss["zimmer"]]
        for g in _gebiete(s["id"]):
            im_gebiet = [a for a in alle if g["stadtteile"] is None or a.get("stadtteil") in g["stadtteile"]]
            zeile = {}
            for typ in ("miete", "kauf"):
                menge = [a for a in im_gebiet if a["typ"] == typ]
                aktiv = [a for a in menge if a.get("aktiv")]
                aenderung = [_preisaenderungen(a, tag) for a in menge]
                zeile[typ] = {
                    "aktiv": len(aktiv),
                    "qm": round(statistics.median(a["preis"] / a["flaeche"] for a in aktiv), 2) if aktiv else None,
                    "neu": sum(a.get("erstmals") == tag for a in menge),
                    "weg": sum(a.get("weg_am") == tag for a in menge),
                    "runter": sum(x[0] for x in aenderung),
                    "hoch": sum(x[1] for x in aenderung),
                }
            aus[g["id"]] = zeile
    return aus
