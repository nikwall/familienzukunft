// App-Rahmen: Tabs. Neue Bereiche werden in BEREICHE eingetragen.
import { zeigeWohnen } from "./wohnen.js";
import { zeigeVorschule } from "./vorschule.js";

const BEREICHE = [
  { id: "wohnen", titel: "Wohnen", zeigen: zeigeWohnen },
  { id: "vorschule", titel: "Vorschule", zeigen: zeigeVorschule },
];

const app = document.getElementById("app");

function rahmen(stand) {
  const tage = Math.ceil((new Date(stand.einstellungen.ziel) - new Date()) / 864e5);
  const ziel = new Date(stand.einstellungen.ziel).toLocaleDateString("de-DE");
  app.innerHTML = `
    <header class="kopf">
      <span class="marke"><img src="wappen.svg" alt="" width="28" height="34">vinifeli</span>
      <nav class="tabs" aria-label="Bereiche">
        ${BEREICHE.map((b) => `<button class="tab" data-id="${b.id}" aria-current="false">${b.titel}</button>`).join("")}
      </nav>
      <span class="uhr" title="Einzug zum ${ziel}"><b>${tage}</b> Tage<span class="lang"> bis zum ${ziel}</span></span>
    </header>
    <div id="bereich"></div>`;
  let abbau = null;
  let lauf = 0;
  const offen = async (id) => {
    const b = BEREICHE.find((x) => x.id === id) || BEREICHE[0];
    const dieser = ++lauf;
    abbau?.();
    abbau = null;
    app.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-current", String(t.dataset.id === b.id)));
    history.replaceState(null, "", b === BEREICHE[0] ? location.pathname : `#${b.id}`);
    window.scrollTo(0, 0);
    // Jeder Bereich bekommt ein frisches Element, damit keine Klick-Empfänger liegen bleiben.
    const huelle = document.createElement("div");
    document.getElementById("bereich").replaceChildren(huelle);
    const r = await b.zeigen(huelle, stand);
    if (dieser === lauf) abbau = r ?? null; else r?.();
  };
  app.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => offen(t.dataset.id)));
  offen(location.hash.slice(1) || BEREICHE[0].id);
}

async function start() {
  const r = await fetch("data/wohnen.json", { cache: "no-store" });
  if (!r.ok) throw new Error(`data/wohnen.json: ${r.status}`);
  rahmen(await r.json());
}

// GitHub Pages lässt Browser Dateien zehn Minuten zwischenspeichern, ein normales Neuladen
// holt Skripte nicht neu. Der Knopf erzwingt das, die Meldung nennt den tatsächlichen Grund.
const DATEIEN = ["index.html", "js/app.js", "js/wohnen.js", "js/vorschule.js", "js/vergleich.js", "js/einordnung.js", "js/karte.js", "js/kartenbasis.js", "js/markt.js", "js/reaktionen.js", "js/format.js", "css/style.css"];

start().catch((e) => {
  console.error(e);
  app.innerHTML = `
    <main class="fehlerseite">
      <p>Die Daten konnten nicht geladen werden.</p>
      <p class="klein" id="grund"></p>
      <p><button id="neu" class="link">Komplett neu laden</button></p>
    </main>`;
  document.getElementById("grund").textContent = e.message;
  document.getElementById("neu").addEventListener("click", async () => {
    await Promise.all(DATEIEN.map((f) => fetch(f, { cache: "reload" }).catch(() => null)));
    location.reload();
  });
});
