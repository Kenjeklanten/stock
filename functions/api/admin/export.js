/** GET /api/admin/export?company_id= — de catalogus van dat bedrijf als CSV (zelfde kolommen als de import). */
import { handler, db, int, HttpError } from '../../_lib/http.js';
import { toCsv, slug } from '../../_lib/csv.js';
import { guard, requireCompany } from './_guard.js';
import { fmt } from '../../_lib/order.js';

export const onRequestGet = handler(async ({ request, env, data }) => {
  const D = db(env);
  const companyId = int(new URL(request.url).searchParams.get('company_id'), null);
  requireCompany(await guard(env, data), companyId);
  const company = await D.prepare('SELECT id, name FROM companies WHERE id = ?1').bind(companyId).first();
  if (!company) throw new HttpError('Onbekend bedrijf.', 404);

  const [locations, products, pars, settings] = await Promise.all([
    D.prepare('SELECT id, name FROM locations WHERE company_id = ?1 AND active = 1 ORDER BY sort, name').bind(companyId).all(),
    D.prepare(`SELECT p.*, s.name AS supplier_name FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
               WHERE p.company_id = ?1 AND p.active = 1 ORDER BY IFNULL(NULLIF(p.category,''),'zzz'), p.sort, p.name`).bind(companyId).all(),
    D.prepare(`SELECT pl.location_id, pl.product_id, pl.base_qty FROM par_levels pl
               JOIN locations l ON l.id = pl.location_id WHERE l.company_id = ?1`).bind(companyId).all(),
    D.prepare("SELECT value FROM settings WHERE key = 'csv_delimiter'").first(),
  ]);

  const locs = locations.results || [];
  const base = new Map();
  for (const row of pars.results || []) base.set(`${row.product_id}|${row.location_id}`, row.base_qty);

  const headers = ['Product', 'Artikelnummer', 'Eenheid', 'Verpakking', 'Verpakkingsnaam', 'Categorie', 'Leverancier',
    ...locs.map((l) => l.name)];
  const rows = (products.results || []).map((p) => [
    p.name, p.sku || '', p.unit || 'stuk', fmt(p.pack_size), p.pack_label || '', p.category || '', p.supplier_name || '',
    ...locs.map((l) => { const v = base.get(`${p.id}|${l.id}`); return v === undefined ? '' : fmt(v); }),
  ]);

  return new Response(toCsv(headers, rows, ((settings && settings.value) || ';').slice(0, 1) || ';'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="producten-basisstock-${slug(company.name)}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
});
