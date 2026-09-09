// De rekenregel van de tool: basisstock − getelde stock = tekort, afgerond naar boven
// op een volle verpakking (besteleenheid).

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Een ingevuld getal, of null als het veld leeg blijft. */
export const filled = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
};

/**
 * Getelde stock uit volle pakken + losse stuks: 2 bakken van 24 en 5 losse = 53.
 * Blijven beide velden leeg, dan is er niet geteld (null).
 */
export function countedTotal(packs, loose, packSize = 1) {
  const p = filled(packs), l = filled(loose);
  if (p === null && l === null) return null;
  const pack = Number(packSize) > 0 ? Number(packSize) : 1;
  return round2((p || 0) * pack + (l || 0));
}

/** Splitst een totaal weer in volle pakken en losse stuks (voor oudere tellingen). */
export function splitCount(total, packSize = 1) {
  if (total === null || total === undefined) return { packs: null, loose: null };
  const pack = Number(packSize) > 0 ? Number(packSize) : 1;
  if (pack <= 1) return { packs: 0, loose: round2(total) };
  const packs = Math.floor(round2(total / pack));
  return { packs, loose: round2(total - packs * pack) };
}

/** Tekort in eenheden (0 als er genoeg staat). */
export function shortage(baseQty, countedQty) {
  if (countedQty === null || countedQty === undefined) return 0;
  return Math.max(0, round2(Number(baseQty || 0) - Number(countedQty)));
}

/** Te bestellen aantal eenheden: tekort opgerond naar een volledige verpakking. */
export function orderQty(baseQty, countedQty, packSize = 1) {
  const need = shortage(baseQty, countedQty);
  if (need <= 0) return 0;
  const pack = Number(packSize) > 0 ? Number(packSize) : 1;
  return round2(Math.ceil(round2(need / pack) - 1e-9) * pack);
}

/** Aantal te bestellen verpakkingen (colli). */
export const orderPacks = (orderUnits, packSize = 1) => {
  const pack = Number(packSize) > 0 ? Number(packSize) : 1;
  return round2(Number(orderUnits || 0) / pack);
};

/** Getal netjes tonen: 12 i.p.v. 12.00, 1,5 i.p.v. 1.5 (Belgisch decimaalteken). */
export const fmt = (n) => {
  const v = round2(n);
  return (Number.isInteger(v) ? String(v) : String(v).replace('.', ',')).replace('-0', '0');
};
