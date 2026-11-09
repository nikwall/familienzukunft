"""Verschlüsselt den App-Stand (AES-256-GCM, Schlüssel per PBKDF2 aus dem Zugangscode).

Das Format entspricht der Entschlüsselung im Browser (siehe js/krypto.js).
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

RUNDEN = 310_000
WURZEL = Path(__file__).resolve().parent.parent
GEHEIM = WURZEL / ".geheim" / "zugang.txt"


def zugangscode() -> str:
    code = os.environ.get("FZ_ZUGANG", "").strip()
    if not code and GEHEIM.exists():
        code = GEHEIM.read_text(encoding="utf-8").strip()
    if not code:
        raise SystemExit("Kein Zugangscode: FZ_ZUGANG setzen oder .geheim/zugang.txt anlegen.")
    return code


def _schluessel(code: str, salz: bytes) -> bytes:
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salz, iterations=RUNDEN).derive(code.encode("utf-8"))


def verschluesseln(obj, code: str) -> dict:
    salz, iv = os.urandom(16), os.urandom(12)
    klar = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ct = AESGCM(_schluessel(code, salz)).encrypt(iv, klar, None)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return {"v": 1, "runden": RUNDEN, "salz": b64(salz), "iv": b64(iv), "daten": b64(ct)}


def entschluesseln(paket: dict, code: str):
    salz, iv, ct = (base64.b64decode(paket[k]) for k in ("salz", "iv", "daten"))
    return json.loads(AESGCM(_schluessel(code, salz)).decrypt(iv, ct, None).decode("utf-8"))
