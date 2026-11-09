// Rechnet Miete und Kauf ineinander um. Reine Funktionen, keine Seiteneffekte.
//
// Grundidee (user cost): Was kostet Wohnen im Eigentum pro Jahr, wirtschaftlich gerechnet?
//   Jahreskosten = Preis × Satz + laufende Eigentümerkosten
//   Satz = Finanzierung (Zins und entgangene Rendite) + Kaufnebenkosten / Haltedauer − Wertzuwachs
// Ein Kaufpreis „entspricht“ einer Miete, wenn beide im Jahr gleich viel kosten.

export const STANDARD = {
  zins: 4.2,       // % p. a., 10 Jahre Zinsbindung (Dr. Klein 9.10.2026: 4,16–4,71; Interhyp 4,2)
  ek: 30,          // % Eigenkapital am Kaufpreis (Annahme)
  ekRendite: 3.5,  // % p. a. nach Steuern, die das Eigenkapital sonst brächte (Annahme)
  wert: 2.0,       // % Wertzuwachs p. a. (Annahme, größter Hebel)
  halten: 15,      // Jahre Haltedauer (Annahme)
  kosten: 30,      // € je m² und Jahr: Instandhaltung, Verwaltung, nicht Umlegbares (Annahme)
  grest: 5.5,      // % Grunderwerbsteuer Hamburg
  notar: 2.0,      // % Notar und Grundbuch
  makler: 3.57,    // % Käuferanteil Makler
};

export const BAND = 0.10;       // innerhalb ±10 % gilt ein Preis als marktüblich
export const GLEICH = 0.05;     // innerhalb ±5 % gelten Kaufen und Mieten als gleichauf
export const TILGUNG = 2.0;     // % anfängliche Tilgung für die Monatsrate

export function kostensatz(a, provisionsfrei = false) {
  const neben = a.grest + a.notar + (provisionsfrei ? 0 : a.makler);
  const finanzierung = (a.ek * a.ekRendite + (100 - a.ek) * a.zins) / 100;
  return (finanzierung + neben / a.halten - a.wert) / 100;
}

export function mieteAusKauf(preis, flaeche, a, provisionsfrei = false) {
  return (preis * kostensatz(a, provisionsfrei) + a.kosten * flaeche) / 12;
}

export function kaufAusMiete(miete, flaeche, a, provisionsfrei = false) {
  const satz = kostensatz(a, provisionsfrei);
  if (satz <= 0) return null; // bei so hohem Wertzuwachs gibt es keinen endlichen Gleichstand
  return Math.max(0, (12 * miete - a.kosten * flaeche) / satz);
}

export function monatsrate(preis, a) {
  return (preis * (1 - a.ek / 100) * (a.zins + TILGUNG)) / 100 / 12;
}

const HAUS = /haus/i;

export function referenz(angebot, preise) {
  const w = preise[angebot.stadtteil];
  if (!w) return null;
  const art = HAUS.test(angebot.art || "") ? "haus" : "wohnung";
  const r = w[art] && w[art].kauf && w[art].miete ? w[art] : w.wohnung;
  if (!r || !r.kauf || !r.miete) return null;
  return { kauf: r.kauf, miete: r.miete, art: r === w[art] ? art : "wohnung" };
}

export function bewerte(angebot, preise, a = STANDARD) {
  const { typ, preis, flaeche, provisionsfrei } = angebot;
  const qm = preis / flaeche;
  const ref = referenz(angebot, preise);
  const aus = { qm, ref, abw: null, urteil: null, gegen: null, rate: typ === "kauf" ? monatsrate(preis, a) : null };
  if (!ref) return aus;

  aus.abw = qm / (typ === "miete" ? ref.miete : ref.kauf) - 1;
  aus.urteil = aus.abw < -BAND ? "guenstig" : aus.abw > BAND ? "teuer" : "fair";

  if (typ === "miete") {
    const wert = kaufAusMiete(preis, flaeche, a);
    const markt = ref.kauf * flaeche;
    // Mehr Wertzuwachs senkt die Kosten des Eigentums und hebt damit den entsprechenden Kaufpreis.
    const unten = kaufAusMiete(preis, flaeche, { ...a, wert: a.wert - 1 });
    const oben = kaufAusMiete(preis, flaeche, { ...a, wert: a.wert + 1 }); // null: kein endlicher Gleichstand
    aus.gegen = {
      art: "kauf", wert, markt, spanne: [unten, oben],
      besser: wert == null ? "mieten" : markt > wert * (1 + GLEICH) ? "mieten" : markt < wert * (1 - GLEICH) ? "kaufen" : "gleich",
    };
  } else {
    const wert = mieteAusKauf(preis, flaeche, a, provisionsfrei);
    const markt = ref.miete * flaeche;
    const unten = mieteAusKauf(preis, flaeche, { ...a, wert: a.wert + 1 }, provisionsfrei);
    const oben = mieteAusKauf(preis, flaeche, { ...a, wert: a.wert - 1 }, provisionsfrei);
    aus.gegen = {
      art: "miete", wert, markt, spanne: [unten, oben],
      besser: wert > markt * (1 + GLEICH) ? "mieten" : wert < markt * (1 - GLEICH) ? "kaufen" : "gleich",
    };
  }
  return aus;
}
