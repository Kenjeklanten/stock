import { json, handler, db, body, int, text, HttpError } from '../../_lib/http.js';
import { requireAdmin } from './_guard.js';

/** GET /api/admin/suppliers?company_id= */
export const onRequestGet = handler(async ({ request, env }) => {
  const companyId = int(new URL(request.url).searchParams.get('company_id'), null);
  const rows = companyId
    ? await db(env).prepare('SELECT * FROM suppliers WHERE company_id = ?1 ORDER BY sort, name').bind(companyId).all()
    : await db(env).prepare('SELECT * FROM suppliers ORDER BY company_id, sort, name').all();
  return json({ suppliers: rows.results || [] });
});

export const onRequestPost = handler(async ({ request, env, data }) => {
  requireAdmin(data);
  const input = (await body(request)) || {};
  const companyId = int(input.company_id, null);
  const name = text(input.name, 80);
  if (!companyId) throw new HttpError('Kies eerst een bedrijf.');
  if (!name) throw new HttpError('Geef de leverancier een naam.');
  try {
    const res = await db(env).prepare('INSERT INTO suppliers (company_id, name, email, customer_ref, sort, active) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(companyId, name, text(input.email, 160), text(input.customer_ref, 60), int(input.sort, 0), input.active === false ? 0 : 1).run();
    return json({ id: res.meta.last_row_id }, 201);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError('Dit bedrijf heeft al een leverancier met die naam.', 409);
    if (String(err.message).includes('FOREIGN KEY')) throw new HttpError('Onbekend bedrijf.', 400);
    throw err;
  }
});

export const onRequestPut = handler(async ({ request, env, data }) => {
  requireAdmin(data);
  const input = (await body(request)) || {};
  const id = int(input.id, null);
  if (!id) throw new HttpError('Ontbrekend nummer.');
  const res = await db(env).prepare(
    'UPDATE suppliers SET name = ?2, email = ?3, customer_ref = ?4, sort = ?5, active = ?6 WHERE id = ?1'
  ).bind(id, text(input.name, 80), text(input.email, 160), text(input.customer_ref, 60), int(input.sort, 0), input.active === false ? 0 : 1).run();
  if (!res.meta.changes) throw new HttpError('Leverancier niet gevonden.', 404);
  return json({ ok: true });
});

export const onRequestDelete = handler(async ({ request, env, data }) => {
  requireAdmin(data);
  const D = db(env);
  const id = int(new URL(request.url).searchParams.get('id'), null);
  if (!id) throw new HttpError('Ontbrekend nummer.');
  const used = await D.prepare('SELECT COUNT(*) AS n FROM products WHERE supplier_id = ?1').bind(id).first();
  if (used && used.n > 0) {
    await D.prepare('UPDATE suppliers SET active = 0 WHERE id = ?1').bind(id).run();
    return json({ ok: true, archived: true, message: `Leverancier is op non-actief gezet (${used.n} producten verwijzen ernaar).` });
  }
  await D.prepare('DELETE FROM suppliers WHERE id = ?1').bind(id).run();
  return json({ ok: true });
});
