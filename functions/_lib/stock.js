/**
 * De actuele stock, en waar ze vandaan komt.
 *
 * De tool telt met momentopnames: een telling is de waarheid op dat moment. Wat er daarna gebeurt,
 * wordt erbij of eraf geteld:
 *
 *   nu in huis = laatste telling
 *              + wat er bij die telling geleverd is (ontvangstcontrole)
 *              + handmatige bewegingen sinds die telling (Rode Kruis, bussen, breuk, …)
 *              − verkoop van op of na de dag van die telling
 *
 * Elk van die vier staat apart in het antwoord, zodat het getal altijd uit te leggen is. Zodra er
 * opnieuw geteld wordt, begint de rekening van voren af aan.
 */
import { round2 } from './order.js';

/**
 * De laatste telling per locatie en product, met wat er toen geteld en geleverd is.
 * `company_id` is verplicht; `location_id` beperkt tot één locatie.
 */
async function laatsteTellingen(D, companyId, locationId) {
  const args = [companyId];
  if (locationId) args.push(locationId);
  const rows = await D.prepare(
    `SELECT cl.product_id, cl.product_name, c.location_id, l.name AS location_name,
            cl.counted_qty, cl.received_qty, cl.order_qty, cl.pack_size, pl.base_qty,
            c.id AS count_id, c.counted_on, c.created_at, c.status,
            p.unit, p.pack_label, p.supplier_id, s.name AS supplier_name, p.sort, p.active
       FROM count_lines cl
       JOIN counts c      ON c.id = cl.count_id
       JOIN locations l   ON l.id = c.location_id
       LEFT JOIN products p  ON p.id = cl.product_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN par_levels pl ON pl.location_id = c.location_id AND pl.product_id = cl.product_id
      WHERE c.company_id = ?1 ${locationId ? 'AND c.location_id = ?2' : ''}
        AND cl.counted_qty IS NOT NULL
        AND c.id = (SELECT c2.id FROM counts c2
                     JOIN count_lines cl2 ON cl2.count_id = c2.id AND cl2.product_id = cl.product_id
                    WHERE c2.location_id = c.location_id AND cl2.counted_qty IS NOT NULL
                    ORDER BY c2.counted_on DESC, c2.id DESC LIMIT 1)`
  ).bind(...args).all();
  return rows.results || [];
}

/** Alles wat er sinds die tellingen nog bij- of afgegaan is. */
async function sindsdien(D, companyId, locationId) {
  const args = [companyId];
  if (locationId) args.push(locationId);
  const filter = locationId ? 'AND m.location_id = ?2' : '';
  const [moves, sales] = await Promise.all([
    D.prepare(
      `SELECT m.location_id, m.product_id, m.moved_on, m.created_at, m.qty
         FROM stock_moves m WHERE m.company_id = ?1 ${filter}`
    ).bind(...args).all(),
    D.prepare(
      `SELECT sloc.location_id, sa.product_id, i.sold_on,
              SUM(sl.qty * IFNULL(sa.units_per_sale, 1)) AS qty
         FROM sales_lines sl
         JOIN sales_imports i     ON i.id = sl.import_id
         JOIN sales_articles sa   ON sa.company_id = i.company_id AND lower(sa.name) = lower(sl.article_name)
         JOIN sales_locations sloc ON sloc.company_id = i.company_id AND lower(sloc.name) = lower(sl.location_name)
        WHERE i.company_id = ?1 ${locationId ? 'AND sloc.location_id = ?2' : ''}
          AND sa.ignored = 0 AND sloc.ignored = 0
          AND sa.product_id IS NOT NULL AND sloc.location_id IS NOT NULL
        GROUP BY sloc.location_id, sa.product_id, i.sold_on`
    ).bind(...args).all(),
  ]);
  return { moves: moves.results || [], sales: sales.results || [] };
}

/**
 * De stand van zaken per locatie en product. Producten die nog nooit geteld zijn, staan er niet
 * bij: daar valt niets over te zeggen.
 */
export async function huidigeStock(D, companyId, { locationId = null } = {}) {
  const basis = await laatsteTellingen(D, companyId, locationId);
  if (!basis.length) return [];
  const { moves, sales } = await sindsdien(D, companyId, locationId);

  const sleutel = (loc, prod) => `${loc}:${prod}`;
  const kaart = new Map(basis.map((b) => [sleutel(b.location_id, b.product_id), b]));

  // Een beweging telt mee als ze ná de telling gebeurde. Op dezelfde dag beslist het tijdstip
  // van invoeren; wat vóór de telling geboekt is, zit al in het getelde aantal.
  const naDeTelling = (m, b) => m.moved_on > b.counted_on || (m.moved_on >= b.counted_on && m.created_at >= b.created_at);

  const bewegingen = new Map();
  for (const m of moves) {
    const k = sleutel(m.location_id, m.product_id);
    const b = kaart.get(k);
    if (!b || !naDeTelling(m, b)) continue;
    bewegingen.set(k, round2((bewegingen.get(k) || 0) + Number(m.qty)));
  }

  const verkocht = new Map();
  for (const v of sales) {
    const b = kaart.get(sleutel(v.location_id, v.product_id));
    // verkoop van op of na de dag van de telling telt mee: er wordt geteld vóór de deuren opengaan
    if (!b || v.sold_on < b.counted_on) continue;
    const k = sleutel(v.location_id, v.product_id);
    verkocht.set(k, round2((verkocht.get(k) || 0) + Number(v.qty)));
  }

  return basis.map((b) => {
    const k = sleutel(b.location_id, b.product_id);
    const geleverd = b.received_qty === null || b.received_qty === undefined ? 0 : Number(b.received_qty);
    const beweging = bewegingen.get(k) || 0;
    const verkoop = verkocht.get(k) || 0;
    return {
      location_id: b.location_id, location_name: b.location_name,
      product_id: b.product_id, product_name: b.product_name,
      unit: b.unit || 'stuk', pack_size: b.pack_size, pack_label: b.pack_label,
      supplier_id: b.supplier_id, supplier_name: b.supplier_name,
      count_id: b.count_id, counted_on: b.counted_on,
      base_qty: b.base_qty === null || b.base_qty === undefined ? null : Number(b.base_qty),
      geteld: Number(b.counted_qty),
      geleverd: round2(geleverd),
      besteld_niet_geleverd: b.received_qty === null || b.received_qty === undefined ? round2(Number(b.order_qty || 0)) : 0,
      bewegingen: beweging,
      verkocht: verkoop,
      nu: round2(Number(b.counted_qty) + geleverd + beweging - verkoop),
    };
  });
}
