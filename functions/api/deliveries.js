/**
 * GET /api/deliveries?company_id=1
 *
 * De leveringen van een bedrijf: wat er besteld is en nog nagekeken moet worden, en wat er
 * al nagekeken is. Een "levering" is hier de bestelling die uit één telling volgde — daar
 * hangen de bestelde aantallen aan waar je de geleverde tegen afzet.
 */
import { json, handler, db, int, HttpError } from '../_lib/http.js';
import { scopeFor, requireCompany, visibleCompanies } from '../_lib/access.js';

/** Per telling: hoeveel bestelregels, hoeveel daarvan nagekeken, en hoeveel er niet klopten. */
const KOLOMMEN = `
  SELECT c.id, c.counted_on, c.status, c.ordered_at, c.received_at, c.received_by,
         c.location_id, l.name AS location_name,
         (SELECT COUNT(*) FROM count_lines cl
           WHERE cl.count_id = c.id AND cl.order_qty > 0) AS order_lines,
         (SELECT COUNT(*) FROM count_lines cl
           WHERE cl.count_id = c.id AND cl.order_qty > 0 AND cl.received_qty IS NOT NULL) AS checked_lines,
         (SELECT COUNT(*) FROM count_lines cl
           WHERE cl.count_id = c.id AND cl.order_qty > 0 AND cl.received_qty IS NOT NULL
             AND cl.received_qty <> cl.order_qty) AS diff_lines,
         (SELECT COUNT(DISTINCT IFNULL(p.supplier_id, 0)) FROM count_lines cl
            LEFT JOIN products p ON p.id = cl.product_id
           WHERE cl.count_id = c.id AND cl.order_qty > 0) AS supplier_count
    FROM counts c JOIN locations l ON l.id = c.location_id
   WHERE c.company_id = ?1`;

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

  const [teDoen, gedaan] = await Promise.all([
    // nog na te kijken: er is besteld, maar de levering is nog niet afgesloten
    D.prepare(
      `SELECT * FROM (${KOLOMMEN} AND c.received_at IS NULL)
        WHERE order_lines > 0
        ORDER BY counted_on DESC, id DESC LIMIT 50`
    ).bind(companyId).all(),

    // afgesloten leveringen, de jongste eerst
    D.prepare(
      `SELECT * FROM (${KOLOMMEN} AND c.received_at IS NOT NULL)
        WHERE order_lines > 0
        ORDER BY received_at DESC, id DESC LIMIT 25`
    ).bind(companyId).all(),
  ]);

  return json({
    company_id: companyId,
    open: teDoen.results || [],
    done: gedaan.results || [],
  });
});
