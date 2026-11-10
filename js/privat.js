// Privater Bereich: Die Daten liegen verschlüsselt im Repository. Der Schlüssel kommt einmal
// über einen persönlichen Link (#privat&k=…) und bleibt dann nur auf diesem Gerät.
import { esc, merken, tagKurz } from "./format.js";

const SCHLUESSEL = "fz_privat";
const TITEL = "fz_privat_titel";
const GEMERKT = "fz_privat_gemerkt";
const WEG = "fz_privat_weg";
const HERZ = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 20.500s-7.500-4.700-9.300-9.300C1.500 8 3.400 4.700 6.800 4.700c2.100 0 3.700 1.100 5.200 3 1.500-1.900 3.100-3 5.200-3 3.400 0 5.300 3.300 4.100 6.500-1.800 4.600-9.300 9.300-9.300 9.300z"/></svg>';

export function privatSchluessel() {
  const m = location.hash.match(/(?:^#|&)k=([A-Za-z0-9_-]{43})/);
  if (m) {
    merken.schreiben(SCHLUESSEL, m[1]);
    history.replaceState(null, "", `${location.pathname}#privat`);
  }
  return merken.lesen(SCHLUESSEL, null);
}

export const privatTitel = () => merken.lesen(TITEL, "Privat");

const bytes = (s) => {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b + "=".repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

async function entschluesseln(schl) {
  const r = await fetch("data/privat.enc.json", { cache: "no-store" });
  if (!r.ok) throw new Error(`Daten nicht gefunden (${r.status})`);
  const d = await r.json();
  const key = await crypto.subtle.importKey("raw", bytes(schl), "AES-GCM", false, ["decrypt"]);
  const klar = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(d.iv) }, key, bytes(d.ct));
  return JSON.parse(new TextDecoder().decode(klar));
}

function wann(iso) {
  const d = new Date(iso);
  const heute = new Date().toLocaleDateString("de-DE");
  const uhr = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("de-DE") === heute ? `heute, ${uhr}` : `${d.toLocaleDateString("de-DE", { day: "numeric", month: "short" })}, ${uhr}`;
}

export async function zeigePrivat(wurzel) {
  wurzel.innerHTML = `<div class="laden">Wird entschlüsselt …</div>`;
  const schl = merken.lesen(SCHLUESSEL, null);
  let d;
  try {
    d = await entschluesseln(schl);
  } catch (e) {
    wurzel.innerHTML = `
      <div class="pv"><p class="leer">Dieser Bereich lässt sich auf diesem Gerät nicht öffnen.<br>Öffne deinen persönlichen Link noch einmal.</p>
      <p class="klein" style="text-align:center">${esc(e.message || "Schlüssel passt nicht")}</p>
      <p style="text-align:center"><button class="link" id="vergessen">Schlüssel auf diesem Gerät löschen</button></p></div>`;
    wurzel.querySelector("#vergessen").addEventListener("click", () => { localStorage.removeItem(SCHLUESSEL); localStorage.removeItem(TITEL); location.hash = ""; location.reload(); });
    return;
  }
  if (d.titel && d.titel !== privatTitel()) {
    merken.schreiben(TITEL, d.titel);
    document.querySelector('.tab[data-id="privat"]')?.replaceChildren(d.titel);
  }
  const alle = Object.values(d.jobs || {});
  const sichtbar0 = alle.filter((j) => j.aktiv && !j.raus);
  const aussortiert = alle.filter((j) => j.aktiv && j.raus);
  // Der erste Abruf ist Ausgangsbestand; „Neu“ gilt erst für spätere Funde.
  const grundTag = alle.reduce((m, j) => (j.erstmals && j.erstmals < m ? j.erstmals : m), "9999");
  const z = { art: "alle", gemerkt: false, sort: "beste", offen: null, raus: false };
  let gemerkt = new Set(merken.lesen(GEMERKT, []));
  let weg = new Set(merken.lesen(WEG, []));

  wurzel.innerHTML = `
    <div class="pv">
      <p class="datenstand an">${d.stand ? `Stand ${wann(d.stand)}` : ""} · ${sichtbar0.length} passende Stellen</p>
      <div class="filter">
        <div class="seg" role="group" aria-label="Auswahl">
          <button data-art="alle" aria-pressed="true">Alle</button>
          <button data-art="teilzeit" aria-pressed="false">Teilzeit</button>
          <button data-art="remote" aria-pressed="false">Remote</button>
          <button data-art="hamburg" aria-pressed="false">Hamburg</button>
        </div>
        <button class="chip" data-schalter="gemerkt" aria-pressed="false">Gemerkt</button>
      </div>
      <div class="unterfilter">
        <span id="anzahl"></span>
        <select id="sort" aria-label="Sortierung"><option value="beste">Beste zuerst</option><option value="neu">Neueste zuerst</option></select>
      </div>
      <div id="liste" class="liste"></div>
      <div class="pv-fuss">
        <button class="link" id="weg-zeigen" hidden></button>
        <button class="link" id="raus-zeigen">Aussortierte ansehen (${aussortiert.length})</button>
        <div id="raus" hidden></div>
        <p class="m-grenzen">Quellen: Jobbörse der Bundesagentur für Arbeit, service.bund.de und die Alert-Mails der Portale. Bewertet nach festen Regeln: Teilzeit, Remote und Hamburg zählen positiv, Vollzeit und tägliche Präsenz außerhalb Hamburgs negativ. Gemerkt und Ausgeblendet speichert nur dieses Gerät.</p>
      </div>
    </div>`;
  const el = (s) => wurzel.querySelector(s);

  function passt(j) {
    if (weg.has(j.id)) return false;
    if (z.gemerkt && !gemerkt.has(j.id)) return false;
    if (z.art === "teilzeit" && !j.teilzeit) return false;
    if (z.art === "remote" && j.lage !== "Remote") return false;
    if (z.art === "hamburg" && j.lage !== "Hamburg") return false;
    return true;
  }

  function kachel(j) {
    const offen = z.offen === j.id;
    const ich = gemerkt.has(j.id);
    const neu = j.erstmals > grundTag && (Date.now() - new Date(j.erstmals)) / 864e5 <= 3;
    const zeile = [j.firma, j.lage, j.teilzeit ? "Teilzeit möglich" : j.vollzeit ? "Vollzeit" : null].filter(Boolean).map(esc).join(" · ");
    return `
    <article class="kachel job ${j.punkte >= 60 ? "guenstig" : j.punkte < 0 ? "teuer" : ""}" data-id="${esc(j.id)}">
      <button class="kachel-kopf" aria-expanded="${offen}">
        <div class="j-titel">${esc(j.titel)}${neu ? ' <span class="neu">Neu</span>' : ""}</div>
        <div class="z2">${zeile}</div>
        ${j.plus?.[0] ? `<div class="pro"><i aria-hidden="true">▲</i><span>${esc(j.plus[0])}</span></div>` : ""}
        ${j.minus?.[0] ? `<div class="contra"><i aria-hidden="true">▼</i><span>${esc(j.minus[0])}</span></div>` : ""}
        <div class="z5"><span>${esc(j.quelle)} · seit ${tagKurz(j.erstmals)}</span>${j.frist ? `<span>Frist ${tagKurz(j.frist)}</span>` : ""}</div>
      </button>
      <button class="herz ${ich ? "an" : ""}" aria-pressed="${ich}" aria-label="Merken">${HERZ}</button>
      ${offen ? `<div class="kachel-detail">
        <ul class="weitere">${[...j.plus.slice(1).map((p) => `<li class="p">${esc(p)}</li>`), ...j.minus.slice(1).map((m) => `<li class="m">${esc(m)}</li>`)].join("")}</ul>
        ${j.text ? `<p class="auszug">${esc(j.text.slice(0, 700))}${j.text.length > 700 ? " …" : ""}</p>` : ""}
        <div class="kand-links">
          ${j.url ? `<a class="zum-inserat" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">Zur Anzeige</a>` : ""}
          <button class="zum-inserat ausblenden">Ausblenden</button>
        </div>
      </div>` : ""}
    </article>`;
  }

  function zeichnen() {
    const liste = sichtbar0.filter(passt).sort(z.sort === "neu"
      ? (a, b) => (b.erstmals || "").localeCompare(a.erstmals || "") || b.punkte - a.punkte
      : (a, b) => b.punkte - a.punkte);
    el("#anzahl").textContent = `${liste.length} ${liste.length === 1 ? "Stelle" : "Stellen"}`;
    el("#liste").innerHTML = liste.length ? liste.map(kachel).join("") : `<p class="leer">Keine Stellen mit dieser Auswahl.</p>`;
    const w = el("#weg-zeigen");
    w.hidden = !weg.size;
    w.textContent = `${weg.size} ausgeblendet · wieder zeigen`;
    if (z.raus) {
      el("#raus").innerHTML = `<ul class="raus-liste">${aussortiert.sort((a, b) => (a.raus || "").localeCompare(b.raus || "")).map((j) => `<li><a href="${esc(j.url || "#")}" target="_blank" rel="noopener noreferrer">${esc(j.titel)}</a><small>${esc([j.firma, j.lage].filter(Boolean).join(" · "))} · ${esc(j.raus)}</small></li>`).join("")}</ul>`;
    }
  }

  wurzel.addEventListener("click", (e) => {
    const t = e.target;
    const art = t.closest("[data-art]");
    if (art) {
      z.art = art.dataset.art;
      wurzel.querySelectorAll("[data-art]").forEach((x) => x.setAttribute("aria-pressed", String(x === art)));
      zeichnen();
      return;
    }
    const sch = t.closest("[data-schalter]");
    if (sch) { z.gemerkt = !z.gemerkt; sch.setAttribute("aria-pressed", String(z.gemerkt)); zeichnen(); return; }
    if (t.closest("#raus-zeigen")) { z.raus = !z.raus; el("#raus").hidden = !z.raus; zeichnen(); return; }
    if (t.closest("#weg-zeigen")) { weg = new Set(); merken.schreiben(WEG, []); zeichnen(); return; }
    const karte = t.closest(".kachel");
    if (!karte) return;
    const id = karte.dataset.id;
    if (t.closest(".herz")) {
      if (gemerkt.has(id)) gemerkt.delete(id); else gemerkt.add(id);
      merken.schreiben(GEMERKT, [...gemerkt]);
      zeichnen();
      return;
    }
    if (t.closest(".ausblenden")) { weg.add(id); merken.schreiben(WEG, [...weg]); z.offen = null; zeichnen(); return; }
    if (t.closest(".kachel-kopf")) { z.offen = z.offen === id ? null : id; zeichnen(); }
  });
  el("#sort").addEventListener("change", (e) => { z.sort = e.target.value; zeichnen(); });
  zeichnen();
}
