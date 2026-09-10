import { HttpError } from './http.js';
import { orderQty, orderPacks, shortage, countedTotal, receiptDiff, filled } from './order.js';

/** Volledige telling + bestelregels, gegroepeerd per leverancier. */
export async function loadCount(D, id) {
  const count = await D.prepare(
    `SELECT c.*, l.name AS location_name, co.name AS company_name
       FROM counts c
       JOIN locations l  ON l.id = c.location_id
       JOIN companies co ON co.id = c.company_id
      WHERE c.id = ?1`
  ).bind(id).first();
  if (!count) throw new HttpError('Telling niet gevonden.', 404);

  const lines = await D.prepare(
    `SELECT cl.product_id, cl.product_name, cl.counted_qty, cl.counted_packs, cl.counted_loose,
            cl.base_qty, cl.pack_size, cl.order_qty,
            cl.received_packs, cl.received_loose, cl.received_qty,
            p.unit, p.pack_label, p.supplier_id, s.name AS supplier_name, p.sort
       FROM count_lines cl
       LEFT JOIN products  p ON p.id = cl.product_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE cl.count_id = ?1
      ORDER BY IFNULL(s.sort, 999), IFNULL(s.name, 'zzz'), IFNULL(p.sort, 0), cl.product_name`
  ).bind(id).all();

  const settings = await D.prepare('SELECT key, value FROM settings').all();

  const rows = (lines.results || []).map((r) => ({
    ...r,
    unit: r.unit || 'stuk',
    shortage: shortage(r.base_qty, r.counted_qty),
    order_packs: orderPacks(r.order_qty, r.pack_size),
    received_diff: receiptDiff(r.order_qty, r.received_qty),
  }));

  return {
    count,
    lines: rows,
    settings: Object.fromEntries((settings.results || []).map((s) => [s.key, s.value])),
  };
}

/** Bestelregels (order_qty > 0), gegroepeerd per leverancier; optioneel gefilterd. */
export function groupBySupplier(lines, supplierFilter = null) {
  const groups = new Map();
  for (const line of lines) {
    if (!(line.order_qty > 0)) continue;
    const key = line.supplier_id ?? 0;
    if (supplierFilter !== null && String(key) !== String(supplierFilter)) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        supplier_id: line.supplier_id ?? null,
        supplier_name: line.supplier_name || 'Zonder leverancier',
        lines: [],
      });
    }
    groups.get(key).lines.push(line);
  }
  return [...groups.values()];
}

/** Slaat de regels van een telling op (vervangt bestaande regels) en herberekent de bestelaantallen. */
export async function saveLines(D, countId, locationId, input) {
  const par = await D.prepare(
    `SELECT pl.product_id, pl.base_qty, p.name, p.pack_size
       FROM par_levels pl JOIN products p ON p.id = pl.product_id
      WHERE pl.location_id = ?1 AND p.active = 1`
  ).bind(locationId).all();

  const known = new Map((par.results || []).map((r) => [r.product_id, r]));
  if (!known.size) throw new HttpError('Deze locatie heeft nog geen producten met een basisstock. Vul die eerst in bij Beheer.', 400);

  // Er wordt geteld in volle pakken + losse stuks; counted_qty blijft aanvaard voor een totaal.
  const counted = new Map();
  for (const line of Array.isArray(input) ? input : []) {
    const pid = Number(line.product_id);
    if (!known.has(pid)) continue;
    const pack = known.get(pid).pack_size;
    const packs = filled(line.packs), loose = filled(line.loose);
    if (packs !== null || loose !== null) {
      counted.set(pid, { packs, loose, qty: countedTotal(packs, loose, pack) });
    } else {
      const qty = filled(line.counted_qty);
      counted.set(pid, { packs: null, loose: null, qty });
    }
  }

  const statements = [D.prepare('DELETE FROM count_lines WHERE count_id = ?1').bind(countId)];
  const insert = D.prepare(
    `INSERT INTO count_lines (count_id, product_id, product_name, counted_packs, counted_loose, counted_qty, base_qty, pack_size, order_qty)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  );
  for (const [pid, prod] of known) {
    const { packs, loose, qty } = counted.get(pid) || { packs: null, loose: null, qty: null };
    statements.push(insert.bind(countId, pid, prod.name, packs, loose, qty, prod.base_qty, prod.pack_size,
      orderQty(prod.base_qty, qty, prod.pack_size)));
  }
  statements.push(D.prepare("UPDATE counts SET updated_at = datetime('now') WHERE id = ?1").bind(countId));
  await D.batch(statements);
}

/**
 * Ontvangstcontrole: noteert per product wat er effectief geleverd is (volle pakken +
 * losse stuks). Enkel de regels die meegestuurd worden, worden bijgewerkt; een regel op
 * null zetten betekent "toch nog niet nagekeken".
 *
 * `complete` zet de telling op 'geleverd' en houdt bij wie ze wanneer heeft nagekeken.
 */
export async function saveReceipt(D, countId, input, { complete = false, by = '' } = {}) {
  const known = await D.prepare(
    'SELECT product_id, pack_size FROM count_lines WHERE count_id = ?1'
  ).bind(countId).all();
  const packs = new Map((known.results || []).map((r) => [r.product_id, r.pack_size]));
  if (!packs.size) throw new HttpError('Deze telling heeft geen regels.', 400);

  const update = D.prepare(
    `UPDATE count_lines SET received_packs = ?3, received_loose = ?4, received_qty = ?5
      WHERE count_id = ?1 AND product_id = ?2`
  );
  const statements = [];
  for (const line of Array.isArray(input) ? input : []) {
    const pid = Number(line.product_id);
    if (!packs.has(pid)) continue;
    const p = filled(line.packs), l = filled(line.loose);
    const qty = countedTotal(p, l, packs.get(pid));
    statements.push(update.bind(countId, pid, p, l, qty));
  }
  if (!statements.length && !complete) throw new HttpError('Er is niets ingevuld.', 400);

  statements.push(complete
    ? D.prepare(
        `UPDATE counts SET status = 'geleverd', received_at = datetime('now'), received_by = ?2,
                updated_at = datetime('now') WHERE id = ?1`
      ).bind(countId, by || null)
    : D.prepare("UPDATE counts SET updated_at = datetime('now') WHERE id = ?1").bind(countId));
  await D.batch(statements);
}
