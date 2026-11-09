// App-Rahmen: Zugang, Tabs. Neue Bereiche werden in BEREICHE eingetragen.
import { entschluesseln } from "./krypto.js";
import { zeigeWohnen } from "./wohnen.js";

const BEREICHE = [
  { id: "wohnen", titel: "Wohnen", zeigen: zeigeWohnen },
];

const app = document.getElementById("app");
const SPEICHER = "fz_zugang";

function gemerkt() {
  try { return localStorage.getItem(SPEICHER); } catch { return null; }
}
function merken(code) {
  try { localStorage.setItem(SPEICHER, code); } catch { /* privater Modus */ }
}

function codeAusLink() {
  const m = location.hash.match(/k=([\w-]+)/);
  if (m) history.replaceState(null, "", location.pathname + location.search);
  return m ? m[1] : null;
}

function zugangsSeite(paket, meldung = "") {
  app.innerHTML = `
    <main class="zugang">
      <h1>Familienzukunft</h1>
      <form>
        <label for="code">Zugangscode</label>
        <input id="code" type="password" autocomplete="current-password" autofocus>
        <button type="submit">Öffnen</button>
        <p class="meldung" role="alert">${meldung}</p>
      </form>
    </main>`;
  app.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    versuchen(paket, app.querySelector("#code").value.trim());
  });
}

async function versuchen(paket, code) {
  let stand;
  try {
    stand = await entschluesseln(paket, code);
  } catch {
    zugangsSeite(paket, "Dieser Code passt nicht.");
    return;
  }
  merken(code);
  rahmen(stand);
}

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
  const r = await fetch("data/wohnen.enc.json", { cache: "no-store" });
  const paket = await r.json();
  const code = codeAusLink() || gemerkt();
  if (code) await versuchen(paket, code);
  else zugangsSeite(paket);
}

start().catch((e) => {
  app.innerHTML = `<main class="zugang"><p>Die Daten konnten nicht geladen werden.</p></main>`;
  console.error(e);
});
