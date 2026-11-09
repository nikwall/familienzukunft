# vinifeli

Private App mit mehreren Bereichen: Wohnen (Hamburg, Würzburg, Lüneburg) und Vorschule.

## Aufbau

- `index.html`, `css/`, `js/`: die App, ohne Build-Schritt. Neue Tabs kommen in `BEREICHE` in `js/app.js`.
- `js/vergleich.js`: Umrechnung zwischen Miete und Kauf.
- `js/einordnung.js`: größte Stärke und Schwäche je Inserat.
- `js/markt.js`: Marktverlauf. `js/karte.js`: Karte Wohnen. `js/kartenbasis.js`: Parks und Gewässer für alle Karten. `js/vorschule.js`: Bereich Vorschule. `js/reaktionen.js`: Likes und Kommentare (Supabase, Tabellen in `tools/supabase.sql`).
- `data/staedte.json`: die Städte. `data/<stadt>/`: öffentliche Daten (Stadtteile, Grundschulen, Haltestellen, Preise, Luft) und die Schnellauswahlen in `gebiete.json`. `data/hamburg/vorschule.json`: Kitas und Vorschulklassen.
- `data/wohnen.json`: Angebote, Einstellungen und der tägliche Marktverlauf (`verlauf`), öffentlich lesbar.
- `pipeline/`: holt Suchauftrags-Mails ab, liest sie, reichert sie an, schreibt `data/wohnen.json`.
- `tools/geodaten_holen.py`, `tools/staedte_holen.py`, `tools/vorschule_holen.py`: erneuern die öffentlichen Daten, etwa einmal im Jahr.
- `.geheim/`: Startwerte, nicht im Repository.

## Automatik

Die Portale verbieten automatische Abrufe. Darum kommen die Angebote über die Suchaufträge der
Portale: Sie landen als Mail in einem eigenen Postfach, GitHub Actions liest es alle 30 Minuten von früh bis spät. Mails ohne erkanntes Angebot bleiben ungelesen.

GitHub Secrets: `FZ_IMAP_HOST`, `FZ_IMAP_USER`, `FZ_IMAP_PASSWORT`.

## Lokal starten

    python -m http.server 8796

## Daten und Lizenzen

Stadtteile, Statistik, Schulen, Kitas, HVV und Lärmkarte Hamburg: Freie und Hansestadt Hamburg, Datenlizenz Deutschland.
Straßenlärm Würzburg und Lüneburg: Europäische Umweltagentur. Luft: Umweltbundesamt (NO₂-Modell, Messstationen).
Stadtteilgrenzen und Straßenbahn Würzburg und Lüneburg: OpenStreetMap (ODbL).
Karte: OpenStreetMap, OpenFreeMap. Karten-Bibliothek: MapLibre GL (`vendor/LICENSE.txt`).
