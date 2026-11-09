// Kleine Helfer für Zahlen und Texte.
export const zahl = (n, d = 0) => (n == null || !isFinite(n) ? "–" : n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const eur = (n) => (n == null || !isFinite(n) ? "–" : `${zahl(Math.round(n))} €`);
export const tausend = (n) => (n == null || !isFinite(n) ? "–" : `${zahl(Math.round(n / 1000) * 1000)} €`);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const tagKurz = (iso) => { const [, m, t] = iso.split("-"); return `${Number(t)}.${Number(m)}.`; };
export const prozent = (x, d = 1) => (x == null || !isFinite(x) ? "–" : `${x > 0 ? "+" : x < 0 ? "−" : "±"}${zahl(Math.abs(x) * 100, d)} %`);
export const merken = {
  lesen(k, ersatz) { try { const v = localStorage.getItem(k); return v == null ? ersatz : JSON.parse(v); } catch { return ersatz; } },
  schreiben(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privater Modus */ } },
};
