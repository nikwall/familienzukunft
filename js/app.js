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

start().catch((e) => {
  app.innerHTML = `<main class="fehlerseite"><p>Die Daten konnten nicht geladen werden.</p></main>`;
  console.error(e);
});
