// Findet je Inserat die größte Stärke und die größte Schwäche.
// Gewichte von 0 bis 100: Wie sehr sticht das Merkmal für diese Suche heraus?
// Unbekanntes zählt nie als Stärke.
import { eur, zahl } from "./format.js";

const proz = (x) => Math.round(Math.abs(x) * 100);
const LINIE = (a) => a.bahn?.linien?.slice(0, 2).join("/") || "Bahn";

export function einordnen(a, b) {
  const plus = [];
  const minus = [];
  const genau = a.lage === "adresse" || a.lage === "strasse";
  const weg = genau ? 1 : 0.5; // Wege aus der Postleitzahl sind unsicher

  // Preis zum Stadtteil
  if (b.abw != null) {
    const g = Math.min(100, Math.abs(b.abw) * 250);
    if (b.abw <= -0.25) plus.push({ t: `Ungewöhnlich günstig (−${proz(b.abw)} %)`, g });
    else if (b.abw <= -0.1) plus.push({ t: `Günstig (−${proz(b.abw)} % zum Stadtteil)`, g });
    else if (b.abw >= 0.25) minus.push({ t: `Ungewöhnlich teuer (+${proz(b.abw)} %)`, g });
    else if (b.abw >= 0.1) minus.push({ t: `Teuer (+${proz(b.abw)} % zum Stadtteil)`, g });
    else plus.push({ t: "Marktüblicher Preis", g: 6 });
  }

  // Preisänderung
  const pv = a.preis_verlauf || [];
  if (pv.length) {
    const d = a.preis / pv[pv.length - 1][1] - 1;
    if (d < 0) plus.push({ t: `Preis gesenkt (−${proz(d)} %)`, g: 60 + Math.min(30, Math.abs(d) * 300) });
    else if (d > 0) minus.push({ t: `Preis erhöht (+${proz(d)} %)`, g: 40 });
  }

  // Draußen
  if (a.garten) plus.push({ t: "Mit Garten", g: 70 });
  else if (a.terrasse) plus.push({ t: "Mit Terrasse", g: 45 });
  else if (a.balkon) plus.push({ t: "Mit Balkon", g: 15 });
  else if (a.balkon === false && a.terrasse === false && a.garten === false) minus.push({ t: "Kein Balkon im Inserat", g: 90 });
  else minus.push({ t: "Balkon nicht bestätigt", g: 18 });

  // Lärm, nur bei bekannter Straße
  if (a.laerm === 0) plus.push({ t: "Sehr ruhige Lage", g: 55 });
  else if (a.laerm === 55) plus.push({ t: "Ruhige Lage", g: 30 });
  else if (a.laerm === 60) minus.push({ t: "Etwas Straßenlärm (60–64 dB)", g: 25 });
  else if (a.laerm === 65) minus.push({ t: "Laute Straße (65–69 dB)", g: 60 });
  else if (a.laerm >= 70) minus.push({ t: `An lauter Hauptstraße (${a.laerm >= 75 ? "ab 75" : "70–74"} dB)`, g: 80 });

  // Wege
  if (a.bahn) {
    if (a.bahn.min <= 5) plus.push({ t: `${LINIE(a)} in ${a.bahn.min} Min zu Fuß`, g: 45 * weg });
    else if (a.bahn.min >= 15) minus.push({ t: `Weit zur Bahn (${a.bahn.min} Min)`, g: 60 * weg });
    else if (a.bahn.min >= 11) minus.push({ t: `Bahn erst in ${a.bahn.min} Min`, g: 28 * weg });
    else plus.push({ t: `${LINIE(a)} in ${a.bahn.min} Min zu Fuß`, g: 12 * weg });
  }
  if (a.schule) {
    if (a.schule.min <= 5) plus.push({ t: `Grundschule in ${a.schule.min} Min`, g: 35 * weg });
    else if (a.schule.min >= 15) minus.push({ t: `Weit zur Grundschule (${a.schule.min} Min)`, g: 35 * weg });
    else if (a.schule.min <= 9) plus.push({ t: `Grundschule in ${a.schule.min} Min`, g: 10 * weg });
  }

  // Energie
  if (a.energie === "A+" || a.energie === "A") plus.push({ t: `Energetisch sparsam (Klasse ${a.energie})`, g: 40 });
  else if (a.energie === "B") plus.push({ t: "Energetisch gut (Klasse B)", g: 20 });
  else if (a.energie === "D") minus.push({ t: "Energetisch mittel (Klasse D)", g: 10 });
  else if (a.energie === "E") minus.push({ t: "Energetisch mäßig (Klasse E)", g: 28 });
  else if (!a.energie) minus.push({ t: "Energieklasse unbekannt", g: 6 });
  else if (["F", "G", "H"].includes(a.energie)) minus.push({ t: `Energetisch teuer (Klasse ${a.energie})`, g: { F: 55, G: 70, H: 80 }[a.energie] });

  // Größe und Sonstiges
  if (a.flaeche >= 130) plus.push({ t: `Viel Platz (${zahl(a.flaeche)} m²)`, g: 35 });
  else if (a.flaeche >= 110) plus.push({ t: `Geräumig (${zahl(a.flaeche)} m²)`, g: 20 });
  if (a.zimmer >= 5) plus.push({ t: `${zahl(a.zimmer, a.zimmer % 1 ? 1 : 0)} Zimmer`, g: 30 });
  if (a.neubau) plus.push({ t: "Neubau, Erstbezug", g: 25 });
  if (a.typ === "kauf" && a.provisionsfrei) plus.push({ t: `Provisionsfrei (spart ${eur(Math.round((a.preis * 0.0357) / 100) * 100)})`, g: 45 });
  if (a.typ === "kauf" && a.kapitalanlage) minus.push({ t: "Evtl. vermietet (Kapitalanlage)", g: 65 });
  if (a.typ === "kauf" && b.gegen?.besser === "kaufen") plus.push({ t: "Kauf schlägt Miete", g: 40 });
  if (a.typ === "kauf" && b.gegen?.besser === "mieten") minus.push({ t: "Mieten wäre günstiger", g: 15 });
  if (!genau) minus.push({ t: "Genaue Lage unbekannt", g: 12 });

  plus.sort((x, y) => y.g - x.g);
  minus.sort((x, y) => y.g - x.g);
  const summe = (l) => l.reduce((s, x) => s + x.g, 0);
  return {
    plus, minus,
    staerke: plus[0]?.t ?? "Keine klare Stärke",
    schwaeche: minus[0]?.t ?? "Keine klare Schwäche",
    punkte: summe(plus) - summe(minus),
  };
}
