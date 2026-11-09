// Entschlüsselt den Datenstand im Browser (Gegenstück zu pipeline/krypto.py).
const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function entschluesseln(paket, code) {
  const roh = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  const schluessel = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: bytes(paket.salz), iterations: paket.runden },
    roh, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );
  const klar = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(paket.iv) }, schluessel, bytes(paket.daten));
  return JSON.parse(new TextDecoder().decode(klar));
}
