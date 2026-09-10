/**
 * De vertaling tussen de kassa en de voorraad.
 *
 * GET  /api/admin/sales-mapping?company_id=1[&import_id=3]
 *   Alle kassanamen die al eens voorbijkwamen, met hun koppeling. Namen die nog niet gekoppeld
 *   zijn, krijgen een voorstel mee (op naam, en op inhoud voor het aantal per verkocht stuk).
 *
 * POST /api/admin/sales-mapping
 *   { company_id, articles: [{ name, product_id, units_per_sale, ignored }],
 *                 locations: [{ name, location_id, ignored }] }
 *
 * Een koppeling wordt bewaard op naam, niet op regel: ze geldt dus meteen voor alle rapporten,
 * ook de rapporten die al ingelezen zijn.
 */
import { json, handler, db, body, int, num, text, HttpError } from '../../_lib/http.js';
import { guard, requireCompany } from './_guard.js';
import { stelProductVoor, stelLocatieVoor } from '../../_lib/sales.js';

/** Alle kassanamen uit de rapporten van dit bedrijf, met hoeveel er ooit van verkocht is. */
async function namen(D, companyId, importId) {
  const args = [companyId];
  if (importId) args.push(importId);
  const filter = importId ? 'AND i.id = ?2' : '';
  const [artikelen, locaties] = await Promise.all([
    D.prepare(
      `SELECT sl.article_name AS name, SUM(sl.qty) AS qty, SUM(IFNULL(sl.revenue, 0)) AS revenue
         FROM sales_lines sl JOIN sales_imports i ON i.id = sl.import_id
        WHERE i.company_id = ?1 ${filter}
        GROUP BY sl.article_name ORDER BY qty DESC`
    ).bind(...args).all(),
    D.prepare(
      `SELECT sl.location_name AS name, SUM(sl.qty) AS qty
         FROM sales_lines sl JOIN sales_imports i ON i.id = sl.import_id
        WHERE i.company_id = ?1 ${filter}
        GROUP BY sl.location_name ORDER BY qty DESC`
    ).bind(...args).all(),
  ]);
  return { artikelen: artikelen.results || [], locaties: locaties.results || [] };
}

export const onRequestGet = handler(async ({ request, env, data }) => {
  const D = db(env);
  const url = new URL(request.url);
  const companyId = requireCompany(await guard(env, data), int(url.searchParams.get('company_id'), null));
  const importId = int(url.searchParams.get('import_id'), null);

  const [{ artikelen, locaties }, producten, stockLocaties, artikelKoppels, locatieKoppels] = await Promise.all([
    namen(D, companyId, importId),
    D.prepare('SELECT id, name, unit, pack_size FROM products WHERE company_id = ?1 AND active = 1 ORDER BY name').bind(companyId).all(),
    D.prepare('SELECT id, name FROM locations WHERE company_id = ?1 AND active = 1 ORDER BY sort, name').bind(companyId).all(),
    D.prepare('SELECT name, product_id, units_per_sale, ignored FROM sales_articles WHERE company_id = ?1').bind(companyId).all(),
    D.prepare('SELECT name, location_id, ignored FROM sales_locations WHERE company_id = ?1').bind(companyId).all(),
  ]);

  const opNaam = (rows) => new Map((rows.results || []).map((r) => [String(r.name).toLowerCase(), r]));
  const gekoppeldArtikel = opNaam(artikelKoppels);
  const gekoppeldeLocatie = opNaam(locatieKoppels);
  const productenLijst = producten.results || [];
  const locatiesLijst = stockLocaties.results || [];

  return json({
    products: productenLijst,
    locations: locatiesLijst,
    articles: artikelen.map((a) => {
      const koppel = gekoppeldArtikel.get(a.name.toLowerCase());
      return {
        ...a,
        product_id: koppel ? koppel.product_id : null,
        units_per_sale: koppel ? koppel.units_per_sale : null,
        ignored: koppel ? !!koppel.ignored : false,
        mapped: !!koppel,
        suggestion: koppel ? null : stelProductVoor(a.name, productenLijst),
      };
    }),
    sales_locations: locaties.map((l) => {
      const koppel = gekoppeldeLocatie.get(l.name.toLowerCase());
      return {
        ...l,
        location_id: koppel ? koppel.location_id : null,
        ignored: koppel ? !!koppel.ignored : false,
        mapped: !!koppel,
        suggestion: koppel ? null : stelLocatieVoor(l.name, locatiesLijst),
      };
    }),
  });
});

export const onRequestPost = handler(async ({ request, env, data }) => {
  const D = db(env);
  const input = (await body(request)) || {};
  const companyId = requireCompany(await guard(env, data), int(input.company_id, null), { manage: true });

  const statements = [];
  for (const a of Array.isArray(input.articles) ? input.articles : []) {
    const naam = text(a.name, 160);
    if (!naam) continue;
    const perStuk = num(a.units_per_sale, 1);
    if (!(perStuk > 0)) throw new HttpError(`Het aantal per verkocht stuk moet groter zijn dan nul (${naam}).`);
    statements.push(D.prepare(
      `INSERT INTO sales_articles (company_id, name, product_id, units_per_sale, ignored) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(company_id, lower(name)) DO UPDATE SET
         product_id = excluded.product_id, units_per_sale = excluded.units_per_sale, ignored = excluded.ignored`
    ).bind(companyId, naam, a.ignored ? null : int(a.product_id, null), perStuk, a.ignored ? 1 : 0));
  }
  for (const l of Array.isArray(input.locations) ? input.locations : []) {
    const naam = text(l.name, 160);
    if (!naam) continue;
    statements.push(D.prepare(
      `INSERT INTO sales_locations (company_id, name, location_id, ignored) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(company_id, lower(name)) DO UPDATE SET
         location_id = excluded.location_id, ignored = excluded.ignored`
    ).bind(companyId, naam, l.ignored ? null : int(l.location_id, null), l.ignored ? 1 : 0));
  }
  if (!statements.length) throw new HttpError('Niets om te bewaren.');
  for (let i = 0; i < statements.length; i += 50) await D.batch(statements.slice(i, i + 50));
  return json({ ok: true, saved: statements.length });
});
