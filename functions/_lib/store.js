import { HttpError } from './http.js';
import { orderQty, orderPacks, shortage, countedTotal, filled } from './order.js';

/** Volledige telling + bestelregels, gegroepeerd per leverancier. */
export async function loadCount(D, id) {
  const count = await D.prepare(
    `SELECT c.*, l.name AS location_name,
            co.name AS company_name, co.address AS company_address, co.vat AS company_vat,
            co.email AS company_email, co.order_footer AS company_footer
       FROM counts c
       JOIN locations l  ON l.id = c.location_id
       JOIN companies co ON co.id = c.company_id
      WHERE c.id = ?1`
  ).bind(id).first();
  if (!count) throw new HttpError('Telling niet gevonden.', 404);

  const lines = await D.prepare(
    `SELECT cl.product_id, cl.product_name, cl.counted_qty, cl.counted_packs, cl.counted_loose,
            cl.base_qty, cl.pack_size, cl.order_qty,
            p.unit, p.pack_label, p.supplier_id, s.name AS supplier_name,
            s.email AS supplier_email, s.customer_ref, p.sort
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
        supplier_email: line.supplier_email || '',
        customer_ref: line.customer_ref || '',
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
