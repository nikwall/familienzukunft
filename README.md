# Familienzukunft

Private App mit mehreren Bereichen. Erster Bereich: Wohnen.

## Aufbau

- `index.html`, `css/`, `js/`: die App, ohne Build-Schritt. Neue Tabs kommen in `BEREICHE` in `js/app.js`.
- `js/vergleich.js`: Umrechnung zwischen Miete und Kauf.
- `js/einordnung.js`: größte Stärke und Schwäche je Inserat.
- `js/markt.js`: Marktverlauf. `js/karte.js`: Karte. `js/reaktionen.js`: Likes und Kommentare (Supabase, Tabellen in `tools/supabase.sql`).
- `data/hamburg/`: öffentliche Daten (Stadtteile, Grundschulen, Schnellbahn, Preise) und die Schnellauswahlen in `gebiete.json`.
- `data/wohnen.json`: Angebote, Einstellungen und der tägliche Marktverlauf (`verlauf`), öffentlich lesbar.
- `pipeline/`: holt Suchauftrags-Mails ab, liest sie, reichert sie an, schreibt `data/wohnen.json`.
- `tools/geodaten_holen.py`: erneuert `data/hamburg/`, etwa einmal im Jahr.
- `.geheim/`: Startwerte, nicht im Repository.

## Automatik

Die Portale verbieten automatische Abrufe. Darum kommen die Angebote über die Suchaufträge der
Portale: Sie landen als Mail in einem eigenen Postfach, GitHub Actions liest es viermal am Tag.

GitHub Secrets: `FZ_IMAP_HOST`, `FZ_IMAP_USER`, `FZ_IMAP_PASSWORT`.

## Lokal starten

    python -m http.server 8796

## Daten und Lizenzen

Stadtteile, Statistik, Schulen, HVV und Lärmkarte: Freie und Hansestadt Hamburg, Datenlizenz Deutschland.
Karte: OpenStreetMap, OpenFreeMap. Karten-Bibliothek: MapLibre GL (`vendor/LICENSE.txt`).
