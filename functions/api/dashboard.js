/**
 * GET /api/dashboard?company_id=1
 *
 * Eén blik op de dag, en niet meer dan dat: waar moet nog geteld worden, wat moet er besteld
 * worden, en welke leveringen moeten nagekeken worden.
 *
 * Wat hier vroeger ook stond, staat nu waar het hoort: de stand van de stock en de laatste
 * bewegingen op /stock, de afwijkingen op /leveringen, en wat er scheef staat in de catalogus
 * bij Beheer. Dat scheelt ook de zwaarste berekening van de tool — huidigeStock over alles —
 * op een scherm dat bij elke paginawissel geladen wordt.
 */
import { json, handler, db, int, today, HttpError } from '../_lib/http.js';
import { scopeFor, requireCompany, visibleCompanies } from '../_lib/access.js';
import { orderPacks } from '../_lib/order.js';
import { openLeveringen } from '../_lib/delivery.js';

export const onRequestGet = handler(async ({ request, env, data }) => {
  const D = db(env);
  const url = new URL(request.url);
  const scope = await scopeFor(D, data.user);

  let companyId = int(url.searchParams.get('company_id'), null);
  if (!companyId) {
    const companies = await D.prepare('SELECT id, name FROM companies WHERE active = 1 ORDER BY sort, name').all();
    const first = visibleCompanies(scope, companies.results || [])[0];
    if (!first) throw new HttpError('Er is nog geen bedrijf om te tonen.', 404);
    companyId = first.id;
  }
  requireCompany(scope, companyId);
  const day = today();

  const [company, locations, recent, openOrders, teBestellen] = await Promise.all([
    D.prepare('SELECT id, name FROM companies WHERE id = ?1').bind(companyId).first(),

    // per locatie de laatste telling
    D.prepare(
      `SELECT l.id, l.name,
              (SELECT c.id         FROM counts c WHERE c.location_id = l.id ORDER BY c.counted_on DESC, c.id DESC LIMIT 1) AS count_id,
              (SELECT c.counted_on FROM counts c WHERE c.location_id = l.id ORDER BY c.counted_on DESC, c.id DESC LIMIT 1) AS counted_on,
              (SELECT c.status     FROM counts c WHERE c.location_id = l.id ORDER BY c.counted_on DESC, c.id DESC LIMIT 1) AS status
         FROM locations l
        WHERE l.company_id = ?1 AND l.active = 1
        ORDER BY l.sort, l.name`
    ).bind(companyId).all(),

    // tellingen van vandaag
    D.prepare(
      `SELECT c.id, c.status, l.name AS location_name,
              (SELECT COUNT(*) FROM count_lines cl WHERE cl.count_id = c.id AND cl.order_qty > 0) AS order_lines
         FROM counts c JOIN locations l ON l.id = c.location_id
        WHERE c.company_id = ?1 AND c.counted_on = ?2
        ORDER BY l.sort, l.name`
    ).bind(companyId, day).all(),

    // alles waar iets op te bestellen stond en wat nog niet nagekeken is — ook wanneer
    // niemand op "markeer als besteld" geduwd heeft, want die levering komt er even goed aan
    openLeveringen(D, companyId, { limit: 20 }),

    // wat er vandaag nog besteld moet worden, opgeteld over alle open tellingen van vandaag
    D.prepare(
      `SELECT IFNULL(s.id, 0) AS supplier_id, IFNULL(s.name, 'Zonder leverancier') AS supplier_name,
              cl.product_name, p.unit, cl.pack_size, SUM(cl.order_qty) AS order_qty
         FROM count_lines cl
         JOIN counts c        ON c.id = cl.count_id
         LEFT JOIN products p ON p.id = cl.product_id
         LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE c.company_id = ?1 AND c.counted_on = ?2 AND c.status = 'open' AND cl.order_qty > 0
        GROUP BY supplier_id, supplier_name, cl.product_name, p.unit, cl.pack_size
        ORDER BY IFNULL(s.sort, 999), supplier_name, cl.product_name`
    ).bind(companyId, day).all(),

  ]);

  // te bestellen per leverancier bundelen
  const suppliers = new Map();
  for (const row of teBestellen.results || []) {
    if (!suppliers.has(row.supplier_id)) {
      suppliers.set(row.supplier_id, { supplier_id: row.supplier_id || null, supplier_name: row.supplier_name, lines: [], units: 0 });
    }
    const group = suppliers.get(row.supplier_id);
    group.lines.push({ ...row, unit: row.unit || 'stuk', order_packs: orderPacks(row.order_qty, row.pack_size) });
    group.units += Number(row.order_qty);
  }

  const counted = new Set((recent.results || []).map((c) => c.location_name));
  const missing = (locations.results || []).filter((l) => !counted.has(l.name));

  return json({
    company,
    today: day,
    locations: locations.results || [],
    counted_today: recent.results || [],
    not_counted_today: missing.map((l) => ({ id: l.id, name: l.name })),
    open_orders: openOrders,
    to_order: [...suppliers.values()],
  });
});
