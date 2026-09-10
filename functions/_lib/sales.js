/**
 * Verkoop uit de kassa naast de voorraad leggen.
 *
 * De kassa telt in glazen en flesjes, de voorraad in vaten en bakken. Dit bestand doet de
 * vertaling en de rekensom die eruit volgt:
 *
 *   verbruik (uit de stock) = geteld bij de vorige telling + wat er toen geleverd is − nu geteld
 *   verkocht (uit de kassa) = aantal × voorraadeenheden per verkocht stuk
 *   verschil                = verbruik − verkocht
 *
 * Een positief verschil is weg zonder verkoop: weggegeven, gemorst, gebroken of gestolen.
 * Een negatief verschil betekent meestal dat er iets niet klopt aan de telling of de koppeling.
 */
import { round2 } from './order.js';

/** "3,3" achteraan een kassanaam is de prijs, geen inhoud: die hoort niet bij de naam. */
const zonderPrijs = (naam) => String(naam || '').replace(/\s+\d+([.,]\d+)?\s*$/, '').trim();

// "toog" en "bar" blijven staan: die dragen juist de betekenis in een locatienaam.
const GENERIEK = new Set(['de', 'het', 'een', 'van', 'the', 'zb', 'pet', 'blik', 'blikjes', 'fles', 'flesjes', 'glas']);

/**
 * Naam terugbrengen tot losse woorden waarop twee bronnen elkaar kunnen vinden.
 * Let op: de prijs wordt hier níét weggeknipt — bij een locatie is "Toog 2" het cijfer dat
 * de togen uit elkaar houdt. Voor kassa-artikelen gebeurt dat apart, in artikelWoorden().
 */
export function woorden(naam) {
  return String(naam || '')
    .toLowerCase()
    .replace(/\d+(?:[.,]\d+)?\s*(?:cl|ml|l|liter|gr|g)\b/g, ' ')   // inhoudsmaten weg
    .replace(/\b\d+\s*[x×]\s*\d*/g, ' ')                            // "24x", "6x1"
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    // losse cijfers blijven: "Toog 2" en "Toog 5" zijn niet hetzelfde
    .filter((w) => w && !GENERIEK.has(w) && (w.length > 1 || /^\d$/.test(w)));
}

/** Bij een kassa-artikel hoort de prijs achteraan niet bij de naam. */
export const artikelWoorden = (naam) => woorden(zonderPrijs(naam));

/**
 * De inhoud van één eenheid, in liter.
 *   "Jupiler 50l"        → 50      (een vat)
 *   "Coca cola 24X25cl"  → 0.25    (één flesje uit de bak)
 *   "Jupiler 30cl 3,3"   → 0.3     (één glas)
 * Geeft null als er geen maat in de naam staat (chips, koffie, …).
 */
export function inhoud(naam) {
  const tekst = zonderPrijs(naam).toLowerCase().replace(',', '.');
  // bij "24x33cl" telt het tweede getal: dat is één eenheid
  const pak = tekst.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(cl|ml|l|liter)\b/);
  const los = tekst.match(/(\d+(?:\.\d+)?)\s*(cl|ml|l|liter)\b/);
  const match = pak ? { waarde: Number(pak[2]), eenheid: pak[3] } : (los ? { waarde: Number(los[1]), eenheid: los[2] } : null);
  if (!match || !Number.isFinite(match.waarde) || match.waarde <= 0) return null;
  const factor = { cl: 0.01, ml: 0.001, l: 1, liter: 1 }[match.eenheid];
  return round2(match.waarde * factor * 1000) / 1000;
}

/**
 * Voorstel voor de koppeling van één kassa-artikel: welk product, hoeveel voorraadeenheden per
 * verkocht stuk, en hoe zeker dat voorstel is. De mens beslist; dit scheelt enkel typwerk.
 */
export function stelProductVoor(artikel, producten) {
  const gezocht = artikelWoorden(artikel);
  if (!gezocht.length) return null;

  let beste = null;
  for (const p of producten) {
    const bij = artikelWoorden(p.name);
    if (!bij.length) continue;
    const raak = gezocht.filter((w) => bij.includes(w)).length;
    if (!raak) continue;
    // hoe meer woorden raak, en hoe minder ruis ernaast, hoe beter
    const score = raak / Math.max(gezocht.length, bij.length);
    if (!beste || score > beste.score) beste = { product: p, score, raak };
  }
  if (!beste || beste.score < 0.34) return null;

  const verkocht = inhoud(artikel);
  const voorraad = inhoud(beste.product.name);
  const factor = verkocht && voorraad ? round2(verkocht / voorraad * 10000) / 10000 : 1;
  return {
    product_id: beste.product.id,
    product_name: beste.product.name,
    units_per_sale: factor,
    zeker: beste.score >= 0.6,
    uitleg: verkocht && voorraad
      ? `${verkocht} l per verkocht stuk, ${voorraad} l per ${beste.product.unit || 'stuk'}`
      : 'geen inhoudsmaat gevonden — één op één aangenomen',
  };
}

/** Zelfde idee voor de toog: "Oost - Toog 2" hoort bij locatie "Toog 2". */
export function stelLocatieVoor(kassaNaam, locaties) {
  const gezocht = woorden(kassaNaam);
  if (!gezocht.length) return null;
  let beste = null;
  for (const l of locaties) {
    const bij = woorden(l.name);
    if (!bij.length) continue;
    const raak = bij.filter((w) => gezocht.includes(w)).length;
    if (raak !== bij.length) continue;            // de hele locatienaam moet erin zitten
    const score = bij.length / gezocht.length;
    if (!beste || score > beste.score) beste = { locatie: l, score };
  }
  return beste ? { location_id: beste.locatie.id, location_name: beste.locatie.name, zeker: beste.score >= 0.5 } : null;
}

/**
 * Het verbruik tussen twee tellingen van dezelfde locatie.
 * `voor` is de telling van vóór de verkoopdag (met wat er toen geleverd is), `na` die erna.
 */
export function verbruik(voorGeteld, geleverd, naGeteld) {
  if (voorGeteld === null || voorGeteld === undefined || naGeteld === null || naGeteld === undefined) return null;
  return round2(Number(voorGeteld) + Number(geleverd || 0) - Number(naGeteld));
}
