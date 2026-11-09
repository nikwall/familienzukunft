# Familienzukunft

Private App mit mehreren Bereichen. Erster Bereich: Wohnen.

## Aufbau

- `index.html`, `css/`, `js/`: die App, ohne Build-Schritt. Neue Tabs kommen in `BEREICHE` in `js/app.js`.
- `js/vergleich.js`: Umrechnung zwischen Miete und Kauf.
- `data/hamburg/`: öffentliche Daten (Stadtteile, Statistik, Grundschulen, Schnellbahn, Preise).
- `data/wohnen.enc.json`: Angebote und Einstellungen, verschlüsselt (AES-256-GCM).
- `pipeline/`: holt Suchauftrags-Mails ab, liest sie, reichert sie an, verschlüsselt das Ergebnis.
- `tools/geodaten_holen.py`: erneuert `data/hamburg/`, etwa einmal im Jahr.
- `.geheim/`: Zugangscode und Startwerte, nie im Repository.

## Automatik

Die Portale verbieten automatische Abrufe. Darum kommen die Angebote über die Suchaufträge der
Portale: Sie landen als Mail in einem eigenen Postfach, GitHub Actions liest es viermal am Tag.

GitHub Secrets: `FZ_ZUGANG`, `FZ_IMAP_HOST`, `FZ_IMAP_USER`, `FZ_IMAP_PASSWORT`.

## Lokal starten

    python -m http.server 8796

## Daten und Lizenzen

Stadtteile, Statistik, Schulen, HVV und Lärmkarte: Freie und Hansestadt Hamburg, Datenlizenz Deutschland.
Karte: OpenStreetMap, OpenFreeMap. Karten-Bibliothek: MapLibre GL (`vendor/LICENSE.txt`).
