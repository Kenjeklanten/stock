/**
 * GET /api/export/xlsx?company_id=1&date=2026-09-09   → de bestellijst van die dag (alle locaties)
 * GET /api/export/xlsx?count_id=12                    → de bestellijst van één telling
 *
 * Zelfde vorm als de bestellijst die met de hand ingevuld werd: één tabblad per leverancier,
 * één kolom per locatie, blokken per categorie en een kolom Totaal.
 */
import { handler, db, int, isDate, HttpError } from '../../_lib/http.js';
import { buildBestellijst, bestellijstNaam } from '../../_lib/bestellijst.js';

const SELECT = `
  SELECT cl.product_id, cl.product_name, cl.order_qty,
         c.location_id, l.name AS location_name, l.sort AS location_sort,
         p.category, p.sort AS product_sort, p.supplier_id,
         s.name AS supplier_name, s.sort AS supplier_sort
    FROM counts c
    JOIN count_lines cl ON cl.count_id = c.id
    JOIN locations l    ON l.id = c.location_id
    LEFT JOIN products  p ON p.id = cl.product_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id`;

export const onRequestGet = handler(async ({ request, env }) => {
  const D = db(env);
  const url = new URL(request.url);
  const countId = int(url.searchParams.get('count_id'), null);
  const companyId = int(url.searchParams.get('company_id'), null);
  const date = url.searchParams.get('date');

  let company;
  let rows;
  if (countId) {
    const count = await D.prepare(
      `SELECT c.counted_on, co.name AS company_name FROM counts c JOIN companies co ON co.id = c.company_id WHERE c.id = ?1`
    ).bind(countId).first();
    if (!count) throw new HttpError('Telling niet gevonden.', 404);
    company = { name: count.company_name, date: count.counted_on };
    rows = await D.prepare(`${SELECT} WHERE c.id = ?1`).bind(countId).all();
  } else {
    if (!companyId) throw new HttpError('Kies een bedrijf.');
    if (!isDate(date)) throw new HttpError('Geef een datum in de vorm JJJJ-MM-DD.');
    const found = await D.prepare('SELECT name FROM companies WHERE id = ?1').bind(companyId).first();
    if (!found) throw new HttpError('Onbekend bedrijf.', 404);
    company = { name: found.name, date };
    rows = await D.prepare(`${SELECT} WHERE c.company_id = ?1 AND c.counted_on = ?2`).bind(companyId, date).all();
  }

  const list = rows.results || [];
  if (!list.length) throw new HttpError('Er zijn voor die dag geen tellingen om te exporteren.', 404);

  const bytes = buildBestellijst({ company: company.name, date: company.date, rows: list });
  return new Response(bytes, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${bestellijstNaam(company.name, company.date)}"`,
      'cache-control': 'no-store',
    },
  });
});
