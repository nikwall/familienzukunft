// Marktverlauf: rechnet die Tagesstände aus und zeichnet den Bericht.
import { esc, prozent, tagKurz, zahl } from "./format.js";

const FENSTER = 7;
const TYPEN = [["miete", "Miete", 2], ["kauf", "Kauf", 0]];

const tageZwischen = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const SUMME = (tage, f) => tage.reduce((s, t) => s + (f(t) ?? 0), 0);

// Rein rechnend, damit es sich testen lässt.
export function marktBericht(verlauf, gebiet) {
  const tage = Object.keys(verlauf || {}).sort().filter((t) => verlauf[t][gebiet]);
  if (!tage.length) return null;
  const letzter = tage[tage.length - 1];
  const start = tage[0];
  // Vergleichstag: der jüngste Tag, der mindestens eine Woche zurückliegt, sonst der erste Tag.
  const vergleich = [...tage].reverse().find((t) => tageZwischen(t, letzter) >= FENSTER) ?? start;
  const danach = tage.filter((t) => t > vergleich);
  const auswerten = (typ) => {
    const z = (t) => verlauf[t][gebiet][typ];
    const jetzt = z(letzter);
    const dann = z(vergleich);
    return {
      jetzt,
      preisDelta: tage.length > 1 && jetzt.qm && dann.qm ? jetzt.qm / dann.qm - 1 : null,
      angebotDelta: tage.length > 1 ? jetzt.aktiv - dann.aktiv : null,
      neu: SUMME(danach, (t) => z(t).neu),
      weg: SUMME(danach, (t) => z(t).weg),
      runter: SUMME(danach, (t) => z(t).runter),
      hoch: SUMME(danach, (t) => z(t).hoch),
      preise: tage.map((t) => ({ t, w: z(t).qm })),
      anzahl: tage.map((t) => ({ t, w: z(t).aktiv })),
    };
  };
  return { tage, start, letzter, vergleich, miete: auswerten("miete"), kauf: auswerten("kauf"), spanne: tageZwischen(vergleich, letzter) >= FENSTER ? "in 7 Tagen" : `seit ${tagKurz(vergleich)}` };
}

export function marktSatz(b) {
  if (b.tage.length < 2) return `Die Aufzeichnung läuft seit ${tagKurz(b.start)}${b.start.slice(0, 4)}. Veränderungen erscheinen ab dem zweiten Tag.`;
  const neu = b.miete.neu + b.kauf.neu;
  const runter = b.miete.runter + b.kauf.runter;
  const teile = [`Miete ${prozent(b.miete.preisDelta)}, Kauf ${prozent(b.kauf.preisDelta)}`];
  teile.push(`${neu} ${neu === 1 ? "neues Inserat" : "neue Inserate"}`);
  if (runter) teile.push(`${runter} ${runter === 1 ? "Preissenkung" : "Preissenkungen"}`);
  return `${b.spanne[0].toUpperCase()}${b.spanne.slice(1)}: ${teile.join(", ")}.`;
}

function diagramm(titel, reihe, fmt, hinweis) {
  const punkte = reihe.filter((p) => p.w != null);
  const letzter = punkte[punkte.length - 1];
  if (punkte.length < 2) {
    return `<figure class="mini"><figcaption>${titel}</figcaption><b>${letzter ? fmt(letzter.w) : "–"}</b><small>${hinweis}</small></figure>`;
  }
  const B = 160, H = 46, R = 6;
  const min = Math.min(...punkte.map((p) => p.w));
  const max = Math.max(...punkte.map((p) => p.w));
  const span = max - min || 1;
  const x = (i) => R + (i / (punkte.length - 1)) * (B - 2 * R);
  const y = (w) => (max === min ? H / 2 : H - R - ((w - min) / span) * (H - 2 * R));
  const pfad = punkte.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.w).toFixed(1)}`).join(" ");
  const daten = esc(JSON.stringify(punkte.map((p, i) => ({ x: +x(i).toFixed(1), y: +y(p.w).toFixed(1), l: `${tagKurz(p.t)}: ${fmt(p.w)}` }))));
  return `
    <figure class="mini" data-punkte="${daten}">
      <figcaption>${titel}</figcaption>
      <b class="wert-jetzt">${fmt(letzter.w)}</b>
      <svg viewBox="0 0 ${B} ${H}" role="img" aria-label="${titel}: Verlauf von ${esc(tagKurz(punkte[0].t))} bis ${esc(tagKurz(letzter.t))}">
        <path d="${pfad}" fill="none" stroke="#256abf" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        <circle class="marke-punkt" cx="${x(punkte.length - 1).toFixed(1)}" cy="${y(letzter.w).toFixed(1)}" r="4" fill="#256abf" stroke="#fff" stroke-width="2"/>
      </svg>
      <small class="wert-zeile">${tagKurz(letzter.t)}: ${fmt(letzter.w)}</small>
    </figure>`;
}

function block(typ, titel, d, b) {
  const qm = (w) => `${zahl(w, d)} €`;
  const x = b[typ];
  const hinweis = b.tage.length < 2 ? "erster Messwert" : "";
  const zaehler = [];
  if (b.tage.length > 1) {
    zaehler.push(`${x.neu} neu`, `${x.weg} weg`);
    if (x.runter) zaehler.push(`${x.runter} × gesenkt`);
    if (x.hoch) zaehler.push(`${x.hoch} × erhöht`);
  }
  return `
    <section class="m-block">
      <header><h3>${titel}</h3>${x.preisDelta == null ? "" : `<span class="m-delta">${prozent(x.preisDelta)} <small>${b.spanne}</small></span>`}</header>
      <div class="m-zwei">
        ${diagramm("Median je m²", x.preise, qm, hinweis)}
        ${diagramm("Aktive Inserate", x.anzahl, (w) => zahl(w), hinweis)}
      </div>
      ${zaehler.length ? `<p class="m-zaehler">${zaehler.join(" · ")}</p>` : ""}
    </section>`;
}

function tabelle(b, verlauf, gebiet) {
  const zeilen = [...b.tage].reverse().slice(0, 30).map((t) => {
    const m = verlauf[t][gebiet].miete, k = verlauf[t][gebiet].kauf;
    return `<tr><th>${tagKurz(t)}</th><td>${zahl(m.qm, 2)}</td><td>${zahl(m.aktiv)}</td><td>${zahl(k.qm)}</td><td>${zahl(k.aktiv)}</td></tr>`;
  }).join("");
  return `<details class="m-tabelle"><summary>Alle Tage</summary><table><thead><tr><td></td><th>Miete €/m²</th><th>Inserate</th><th>Kauf €/m²</th><th>Inserate</th></tr></thead><tbody>${zeilen}</tbody></table></details>`;
}

export function zeigeMarkt(el, verlauf, gebiet) {
  const b = marktBericht(verlauf, gebiet.id);
  if (!b) {
    el.innerHTML = `<p class="leer">Noch keine Aufzeichnung.</p>`;
    return;
  }
  el.innerHTML = `
    <h2 class="m-titel">${esc(gebiet.titel)}</h2>
    <p class="m-satz">${marktSatz(b)}</p>
    ${TYPEN.map(([t, n, d]) => block(t, n, d, b)).join("")}
    ${b.tage.length > 1 ? tabelle(b, verlauf, gebiet.id) : ""}
    <p class="m-grenzen">Die Mediane gelten für die jeweils aktiven Inserate. Ändert sich die Mischung, bewegt sich der Median auch ohne echte Preisänderung. Neu und Preisänderungen kennt die App nur aus den Suchauftrags-Mails. Als weg gilt ein Inserat nach 45 Tagen ohne neuen Hinweis.</p>
    <p class="m-grenzen"><button class="link" id="annahmen-oeffnen">Annahmen und Quellen</button></p>`;
  el.querySelectorAll(".mini[data-punkte]").forEach((fig) => {
    const punkte = JSON.parse(fig.dataset.punkte);
    const svg = fig.querySelector("svg");
    const kreis = fig.querySelector(".marke-punkt");
    const zeile = fig.querySelector(".wert-zeile");
    const zeige = (e) => {
      const r = svg.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 160;
      const p = punkte.reduce((a, c) => (Math.abs(c.x - x) < Math.abs(a.x - x) ? c : a));
      kreis.setAttribute("cx", p.x);
      kreis.setAttribute("cy", p.y);
      zeile.textContent = p.l;
    };
    svg.addEventListener("pointerdown", zeige);
    svg.addEventListener("pointermove", zeige);
  });
}
