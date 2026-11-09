// App-Rahmen: Tabs. Neue Bereiche werden in BEREICHE eingetragen.
import { zeigeWohnen } from "./wohnen.js";

const BEREICHE = [
  { id: "wohnen", titel: "Wohnen", zeigen: zeigeWohnen },
];

const app = document.getElementById("app");

function rahmen(stand) {
  const tage = Math.ceil((new Date(stand.einstellungen.ziel) - new Date()) / 864e5);
  const ziel = new Date(stand.einstellungen.ziel).toLocaleDateString("de-DE");
  app.innerHTML = `
    <header class="kopf">
      <span class="marke">Familienzukunft</span>
      <nav class="tabs" aria-label="Bereiche">
        ${BEREICHE.map((b) => `<button class="tab" data-id="${b.id}" aria-current="false">${b.titel}</button>`).join("")}
      </nav>
      <span class="uhr" title="Einzug zum ${ziel}"><b>${tage}</b> Tage<span class="lang"> bis zum ${ziel}</span></span>
    </header>
    <div id="bereich"></div>`;
  const offen = (id) => {
    const b = BEREICHE.find((x) => x.id === id) || BEREICHE[0];
    app.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-current", String(t.dataset.id === b.id)));
    b.zeigen(document.getElementById("bereich"), stand);
  };
  app.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => offen(t.dataset.id)));
  offen(BEREICHE[0].id);
}

async function start() {
  const r = await fetch("data/wohnen.json", { cache: "no-store" });
  if (!r.ok) throw new Error(`data/wohnen.json: ${r.status}`);
  rahmen(await r.json());
}

// GitHub Pages lässt Browser Dateien zehn Minuten zwischenspeichern, ein normales Neuladen
// holt Skripte nicht neu. Der Knopf erzwingt das, die Meldung nennt den tatsächlichen Grund.
const DATEIEN = ["index.html", "js/app.js", "js/wohnen.js", "js/vergleich.js", "css/style.css"];

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
