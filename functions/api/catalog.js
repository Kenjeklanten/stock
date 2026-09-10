import { json, handler, db, int } from '../_lib/http.js';
import { scopeFor, visibleCompanies, requireCompany, mayManage } from '../_lib/access.js';

/**
 * GET /api/catalog                              → bedrijven (+ wie je bent)
 * GET /api/catalog?company_id=1                 → locaties, leveranciers en instellingen van dat bedrijf
 * GET /api/catalog?company_id=1&location_id=3   → idem, plus de producten van die locatie met hun basisstock
 * GET /api/catalog?company_id=1&all=1           → idem, plus alle producten met basisstock per locatie (beheer)
 */
export const onRequestGet = handler(async ({ request, env, data }) => {
  const D = db(env);
  const url = new URL(request.url);
  const companyId = int(url.searchParams.get('company_id'), null);
  const locationId = int(url.searchParams.get('location_id'), null);
  const all = url.searchParams.get('all') === '1';

  const [companies, settings, scope] = await Promise.all([
    D.prepare('SELECT id, name, sort, active FROM companies ORDER BY sort, name').all(),
    D.prepare('SELECT key, value FROM settings').all(),
    scopeFor(D, data.user),
  ]);

  const allowed = visibleCompanies(scope, companies.results || []);
  const out = {
    user: {
      ...data.user,
      super_admin: scope.canAdminister,
      can_manage: companyId ? mayManage(scope, companyId) : false,
      // met welke toegangscode deze browser binnen is (null = geen code ingesteld)
      code: scope.code,
      // welke bedrijven deze code mag beheren: 'all' of een lijst met nummers
      manageable: scope.manageAll
        ? 'all'
        : (scope.role === 'beheerder' ? [...scope.companies] : []),
    },
    companies: allowed,
    settings: Object.fromEntries((settings.results || []).map((r) => [r.key, r.value])),
  };
  if (!companyId) return json(out);
  requireCompany(scope, companyId);

  out.company = allowed.find((c) => c.id === companyId) || null;
  const [locations, suppliers] = await Promise.all([
    D.prepare('SELECT id, name, sort, active FROM locations WHERE company_id = ?1 ORDER BY sort, name').bind(companyId).all(),
    D.prepare('SELECT id, name, sort FROM suppliers WHERE company_id = ?1 ORDER BY sort, name').bind(companyId).all(),
  ]);
  out.locations = locations.results || [];
  out.suppliers = suppliers.results || [];

  if (locationId) {
    const products = await D.prepare(
      `SELECT p.id, p.name, p.unit, p.pack_size, p.pack_label, p.supplier_id,
              s.name AS supplier_name, p.sort, pl.base_qty
         FROM par_levels pl
         JOIN products p    ON p.id = pl.product_id
         JOIN locations l   ON l.id = pl.location_id
         LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE pl.location_id = ?1 AND l.company_id = ?2 AND p.active = 1
        ORDER BY IFNULL(s.sort, 999), IFNULL(s.name, 'zzz'), p.sort, p.name`
    ).bind(locationId, companyId).all();
    out.products = products.results || [];
    out.last_count = await D.prepare(
      'SELECT id, counted_on, status, created_by FROM counts WHERE location_id = ?1 ORDER BY counted_on DESC, id DESC LIMIT 1'
    ).bind(locationId).first() || null;
  } else if (all) {
    const products = await D.prepare(
      `SELECT p.id, p.name, p.unit, p.pack_size, p.pack_label, p.supplier_id,
              s.name AS supplier_name, p.sort, p.active
         FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.company_id = ?1
        ORDER BY IFNULL(s.sort, 999), IFNULL(s.name, 'zzz'), p.sort, p.name`
    ).bind(companyId).all();
    const pars = await D.prepare(
      `SELECT pl.location_id, pl.product_id, pl.base_qty
         FROM par_levels pl JOIN locations l ON l.id = pl.location_id
        WHERE l.company_id = ?1`
    ).bind(companyId).all();
    const byProduct = new Map();
    for (const row of pars.results || []) {
      if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, {});
      byProduct.get(row.product_id)[row.location_id] = row.base_qty;
    }
    out.products = (products.results || []).map((p) => ({ ...p, base: byProduct.get(p.id) || {} }));
  }

  return json(out);
});
