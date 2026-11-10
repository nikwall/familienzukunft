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

## Morgennachricht

Jeden Morgen gegen 7 Uhr schickt `pipeline/morgen.py` (Workflow `morgen.yml`) eine WhatsApp: neue und
vom Markt genommene Angebote des Vortags in Nachbarschaft Scheideweg und Greater Eimsbüttel, dazu der Link zur App.
Versand über CallMeBot. Jede Person schickt dem Bot einmal „I allow callmebot to send me messages“ und
bekommt einen Schlüssel. Secret `FZ_WHATSAPP`, eine Zeile je Person: `+491701234567 123456`.
Probelauf ohne Versand: `python pipeline/morgen.py --zeigen`.
„Vom Markt“ heißt: 45 Tage nicht mehr gemeldet. Die Portale sagen nicht, wann ein Inserat verschwindet.

## Lokal starten

    python -m http.server 8796

## Daten und Lizenzen

Stadtteile, Statistik, Schulen, Kitas, HVV und Lärmkarte Hamburg: Freie und Hansestadt Hamburg, Datenlizenz Deutschland.
Straßenlärm Würzburg und Lüneburg: Europäische Umweltagentur. Luft: Umweltbundesamt (NO₂-Modell, Messstationen).
Stadtteilgrenzen und Straßenbahn Würzburg und Lüneburg: OpenStreetMap (ODbL).
Karte: OpenStreetMap, OpenFreeMap. Karten-Bibliothek: MapLibre GL (`vendor/LICENSE.txt`).
