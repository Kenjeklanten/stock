import { json, handler, db, body, int, num, text, HttpError } from '../../_lib/http.js';
import { requireAdmin } from './_guard.js';

const fields = (input) => ({
  name: text(input.name, 120),
  sku: text(input.sku, 60),
  unit: text(input.unit, 24) || 'stuk',
  pack_size: Math.max(num(input.pack_size, 1) || 1, 0.01),
  pack_label: text(input.pack_label, 60),
  category: text(input.category, 60),
  supplier_id: int(input.supplier_id, null) || null,
  sort: int(input.sort, 0),
  active: input.active === false ? 0 : 1,
});

/**
 * Basisstock per locatie mee opslaan: {"3": 24, "5": ""} — leeg betekent "niet in deze locatie".
 * Alleen locaties van hetzelfde bedrijf worden aanvaard.
 */
async function saveBase(D, productId, companyId, base) {
  if (!base || typeof base !== 'object') return;
  const own = await D.prepare('SELECT id FROM locations WHERE company_id = ?1').bind(companyId).all();
  const allowed = new Set((own.results || []).map((r) => r.id));
  const statements = [];
  for (const [locationId, value] of Object.entries(base)) {
    const lid = int(locationId, null);
    if (!lid || !allowed.has(lid)) continue;
    const qty = num(value, null);
    statements.push(qty === null || value === ''
      ? D.prepare('DELETE FROM par_levels WHERE location_id = ?1 AND product_id = ?2').bind(lid, productId)
      : D.prepare(`INSERT INTO par_levels (location_id, product_id, base_qty) VALUES (?1, ?2, ?3)
                   ON CONFLICT(location_id, product_id) DO UPDATE SET base_qty = excluded.base_qty`).bind(lid, productId, Math.max(0, qty)));
  }
  if (statements.length) await D.batch(statements);
}

export const onRequestPost = handler(async ({ request, env, data }) => {
  requireAdmin(data);
  const D = db(env);
  const input = (await body(request)) || {};
  const companyId = int(input.company_id, null);
  const f = fields(input);
  if (!companyId) throw new HttpError('Kies eerst een bedrijf.');
  if (!f.name) throw new HttpError('Geef het product een naam.');
  let id;
  try {
    const res = await D.prepare(
      `INSERT INTO products (company_id, name, sku, unit, pack_size, pack_label, category, supplier_id, sort, active)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    ).bind(companyId, f.name, f.sku, f.unit, f.pack_size, f.pack_label, f.category, f.supplier_id, f.sort, f.active).run();
    id = res.meta.last_row_id;
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError('Dit product bestaat al bij deze leverancier.', 409);
    if (String(err.message).includes('FOREIGN KEY')) throw new HttpError('Onbekend bedrijf of onbekende leverancier.', 400);
    throw err;
  }
  await saveBase(D, id, companyId, input.base);
  return json({ id }, 201);
});

export const onRequestPut = handler(async ({ request, env, data }) => {
  requireAdmin(data);
  const D = db(env);
  const input = (await body(request)) || {};
  const id = int(input.id, null);
  if (!id) throw new HttpError('Ontbrekend nummer.');
  const f = fields(input);
  if (!f.name) throw new HttpError('Geef het product een naam.');
  const product = await D.prepare('SELECT company_id FROM products WHERE id = ?1').bind(id).first();
  if (!product) throw new HttpError('Product niet gevonden.', 404);
  const res = await D.prepare(
    `UPDATE products SET name = ?2, sku = ?3, unit = ?4, pack_size = ?5, pack_label = ?6,
            category = ?7, supplier_id = ?8, sort = ?9, active = ?10 WHERE id = ?1`
  ).bind(id, f.name, f.sku, f.unit, f.pack_size, f.pack_label, f.category, f.supplier_id, f.sort, f.active).run();
  await saveBase(D, id, product.company_id, input.base);
  return json({ ok: true, changes: res.meta.changes });
});

export const onRequestDelete = handler(async ({ request, env, data }) => {
  requireAdmin(data);
  const D = db(env);
  const id = int(new URL(request.url).searchParams.get('id'), null);
  if (!id) throw new HttpError('Ontbrekend nummer.');
  const used = await D.prepare('SELECT COUNT(*) AS n FROM count_lines WHERE product_id = ?1').bind(id).first();
  if (used && used.n > 0) {
    await D.prepare('UPDATE products SET active = 0 WHERE id = ?1').bind(id).run();
    return json({ ok: true, archived: true, message: 'Product is op non-actief gezet (het staat in bestaande tellingen).' });
  }
  await D.prepare('DELETE FROM par_levels WHERE product_id = ?1').bind(id).run();
  await D.prepare('DELETE FROM products WHERE id = ?1').bind(id).run();
  return json({ ok: true });
});
