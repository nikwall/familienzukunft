// Likes und Kommentare in der Datenbank (Supabase).
// Der Schlüssel ist bewusst öffentlich; die Regeln in tools/supabase.sql bestimmen, was er darf.
const BASIS = "https://rykkwkogdilnaifignvu.supabase.co/rest/v1/";
const SCHLUESSEL = "sb_publishable_MdwZc5n_DPuv5scI_CIOWA_VBXDoCBM";

function abruf(pfad, opt = {}) {
  return fetch(BASIS + pfad, { ...opt, headers: { apikey: SCHLUESSEL, "Content-Type": "application/json", ...(opt.headers || {}) } });
}

async function pruefen(r) {
  if (!r.ok) throw new Error(`Datenbank: ${r.status}`);
  return r;
}

export async function ladeReaktionen() {
  const [l, k] = await Promise.all([
    abruf("fz_likes?select=angebot,name").then(pruefen).then((r) => r.json()),
    abruf("fz_kommentare?select=id,angebot,name,text,erstellt&order=erstellt.asc").then(pruefen).then((r) => r.json()),
  ]);
  const likes = new Map();
  for (const z of l) (likes.get(z.angebot) ?? likes.set(z.angebot, new Set()).get(z.angebot)).add(z.name);
  const kommentare = new Map();
  for (const z of k) (kommentare.get(z.angebot) ?? kommentare.set(z.angebot, []).get(z.angebot)).push(z);
  return { likes, kommentare, verfuegbar: true };
}

export async function setzeLike(angebot, name, an) {
  if (an) {
    await abruf("fz_likes", { method: "POST", headers: { Prefer: "return=minimal,resolution=ignore-duplicates" }, body: JSON.stringify({ angebot, name }) }).then(pruefen);
  } else {
    await abruf(`fz_likes?angebot=eq.${encodeURIComponent(angebot)}&name=eq.${encodeURIComponent(name)}`, { method: "DELETE" }).then(pruefen);
  }
}

export async function schreibeKommentar(angebot, name, text) {
  const r = await abruf("fz_kommentare?select=id,angebot,name,text,erstellt", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ angebot, name, text }) }).then(pruefen);
  return (await r.json())[0];
}

export async function loescheKommentar(id) {
  await abruf(`fz_kommentare?id=eq.${Number(id)}`, { method: "DELETE" }).then(pruefen);
}
