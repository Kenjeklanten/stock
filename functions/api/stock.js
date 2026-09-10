/**
 * GET /api/stock?company_id=[&location_id=]
 *   De actuele stock per locatie en product, met de opbouw ervan (zie _lib/stock.js).
 *
 * GET /api/stock?company_id=&location_id=&product_id=&timeline=1
 *   De tijdlijn van één product op één locatie: elke telling, levering, handmatige beweging en
 *   verkoopdag, van nieuw naar oud, met de stand na elke stap.
 */
import { json, handler, db, int, HttpError } from '../_lib/http.js';
import { scopeFor, requireCompany } from '../_lib/access.js';
import { huidigeStock } from '../_lib/stock.js';
import { round2 } from '../_lib/order.js';

/** Alle gebeurtenissen rond één product op één locatie, van oud naar nieuw. */
async function tijdlijn(D, companyId, locationId, productId) {
  const [tellingen, bewegingen, verkoop, plek, product] = await Promise.all([
    D.prepare(
      `SELECT c.id, c.counted_on, c.created_at, c.created_by, c.status, c.note,
              cl.counted_qty, cl.counted_packs, cl.counted_loose, cl.order_qty, cl.received_qty,
              c.received_at, c.received_by, c.ordered_at
         FROM counts c JOIN count_lines cl ON cl.count_id = c.id AND cl.product_id = ?3
        WHERE c.company_id = ?1 AND c.location_id = ?2
        ORDER BY c.counted_on, c.id`
    ).bind(companyId, locationId, productId).all(),
    D.prepare(
      `SELECT m.id, m.qty, m.note, m.moved_on, m.created_at, m.created_by, r.name AS reason_name
         FROM stock_moves m LEFT JOIN stock_reasons r ON r.id = m.reason_id
        WHERE m.company_id = ?1 AND m.location_id = ?2 AND m.product_id = ?3
        ORDER BY m.moved_on, m.id`
    ).bind(companyId, locationId, productId).all(),
    D.prepare(
      `SELECT i.id, i.label, i.sold_on, SUM(sl.qty * IFNULL(sa.units_per_sale, 1)) AS qty
         FROM sales_lines sl
         JOIN sales_imports i      ON i.id = sl.import_id
         JOIN sales_articles sa    ON sa.company_id = i.company_id AND lower(sa.name) = lower(sl.article_name)
         JOIN sales_locations sloc ON sloc.company_id = i.company_id AND lower(sloc.name) = lower(sl.location_name)
        WHERE i.company_id = ?1 AND sloc.location_id = ?2 AND sa.product_id = ?3
          AND sa.ignored = 0 AND sloc.ignored = 0
        GROUP BY i.id, i.label, i.sold_on ORDER BY i.sold_on, i.id`
    ).bind(companyId, locationId, productId).all(),
    D.prepare('SELECT id, name FROM locations WHERE id = ?1 AND company_id = ?2').bind(locationId, companyId).first(),
    D.prepare('SELECT id, name, unit, pack_size, pack_label FROM products WHERE id = ?1 AND company_id = ?2').bind(productId, companyId).first(),
  ]);
  if (!plek || !product) throw new HttpError('Onbekende locatie of product voor dit bedrijf.', 404);

  const events = [];
  for (const c of tellingen.results || []) {
    if (c.counted_qty !== null && c.counted_qty !== undefined) {
      events.push({
        soort: 'telling', op: c.counted_on, sorteer: c.created_at, id: c.id,
        stand: Number(c.counted_qty), door: c.created_by,
        tekst: c.counted_packs !== null && c.counted_packs !== undefined
          ? `Geteld: ${c.counted_packs} pak + ${c.counted_loose || 0} los`
          : 'Geteld',
        note: c.note || '',
      });
    }
    if (c.received_qty !== null && c.received_qty !== undefined) {
      events.push({
        soort: 'levering', op: (c.received_at || c.counted_on).slice(0, 10), sorteer: c.received_at || c.created_at,
        id: c.id, delta: Number(c.received_qty), door: c.received_by,
        tekst: `Geleverd, besteld was ${c.order_qty}`,
      });
    } else if (c.order_qty > 0 && c.status !== 'open') {
      events.push({
        soort: 'besteld', op: (c.ordered_at || c.counted_on).slice(0, 10), sorteer: c.ordered_at || c.created_at,
        id: c.id, delta: 0, tekst: `Besteld: ${c.order_qty} (nog niet nagekeken)`,
      });
    }
  }
  for (const m of bewegingen.results || []) {
    events.push({
      soort: 'beweging', op: m.moved_on, sorteer: m.created_at, id: m.id, delta: Number(m.qty),
      door: m.created_by, tekst: m.reason_name || 'Handmatige aanpassing', note: m.note || '',
    });
  }
  for (const v of verkoop.results || []) {
    events.push({
      soort: 'verkoop', op: v.sold_on, sorteer: `${v.sold_on} 23:59:59`, id: v.id,
      delta: -round2(Number(v.qty)), tekst: v.label,
    });
  }

  // op datum, en binnen dezelfde dag op het moment van invoeren
  events.sort((a, b) => a.op.localeCompare(b.op) || String(a.sorteer).localeCompare(String(b.sorteer)));

  // de stand meelopen: een telling zet ze vast, de rest telt erbij of eraf
  let stand = null;
  for (const e of events) {
    if (e.soort === 'telling') stand = e.stand;
    else if (stand !== null) stand = round2(stand + (e.delta || 0));
    e.saldo = stand;
  }
  return { location: plek, product, events: events.reverse() };
}

export const onRequestGet = handler(async ({ request, env, data }) => {
  const D = db(env);
  const url = new URL(request.url);
  const scope = await scopeFor(D, data.user);
  const companyId = requireCompany(scope, int(url.searchParams.get('company_id'), null));
  const locationId = int(url.searchParams.get('location_id'), null);
  const productId = int(url.searchParams.get('product_id'), null);

  if (url.searchParams.get('timeline') === '1') {
    if (!locationId || !productId) throw new HttpError('Kies een locatie en een product.');
    return json(await tijdlijn(D, companyId, locationId, productId));
  }
  return json({ stock: await huidigeStock(D, companyId, { locationId }) });
});
