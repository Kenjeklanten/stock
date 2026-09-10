/**
 * De redenen waarom er drank uit de stock gaat of erbij komt: "Drank Rode Kruis",
 * "Drank bussen", "Breuk", "Personeel", "Verhuis naar andere toog", …
 *
 * GET    /api/admin/reasons?company_id=
 * POST   /api/admin/reasons   { company_id, name, direction: 'uit'|'in'|'beide' }
 * PUT    /api/admin/reasons   { id, name, direction, active }
 * DELETE /api/admin/reasons?id=
 *
 * Een reden die al gebruikt is, wordt op non-actief gezet in plaats van verwijderd: anders zou
 * een oude beweging niet meer te lezen zijn.
 */
import { json, handler, db, body, int, text, HttpError } from '../../_lib/http.js';
import { guard, requireCompany, requireRowCompany } from './_guard.js';

const RICHTINGEN = ['uit', 'in', 'beide'];
const richting = (v) => (RICHTINGEN.includes(v) ? v : 'uit');

export const onRequestGet = handler(async ({ request, env, data }) => {
  const companyId = requireCompany(await guard(env, data), int(new URL(request.url).searchParams.get('company_id'), null));
  const rows = await db(env).prepare(
    'SELECT id, name, direction, sort, active FROM stock_reasons WHERE company_id = ?1 ORDER BY sort, name'
  ).bind(companyId).all();
  return json({ reasons: rows.results || [] });
});

export const onRequestPost = handler(async ({ request, env, data }) => {
  const input = (await body(request)) || {};
  const companyId = requireCompany(await guard(env, data), int(input.company_id, null), { manage: true });
  const name = text(input.name, 80);
  if (!name) throw new HttpError('Geef de reden een naam.');
  try {
    const res = await db(env).prepare(
      'INSERT INTO stock_reasons (company_id, name, direction, sort) VALUES (?1, ?2, ?3, ?4)'
    ).bind(companyId, name, richting(input.direction), int(input.sort, 0)).run();
    return json({ id: res.meta.last_row_id }, 201);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError('Die reden bestaat al.', 409);
    throw err;
  }
});

export const onRequestPut = handler(async ({ request, env, data }) => {
  const input = (await body(request)) || {};
  const id = int(input.id, null);
  if (!id) throw new HttpError('Ontbrekend nummer.');
  await requireRowCompany(env, data, 'stock_reasons', id);
  const res = await db(env).prepare(
    'UPDATE stock_reasons SET name = ?2, direction = ?3, sort = ?4, active = ?5 WHERE id = ?1'
  ).bind(id, text(input.name, 80), richting(input.direction), int(input.sort, 0), input.active === false ? 0 : 1).run();
  if (!res.meta.changes) throw new HttpError('Die reden bestaat niet.', 404);
  return json({ ok: true });
});

export const onRequestDelete = handler(async ({ request, env, data }) => {
  const D = db(env);
  const id = int(new URL(request.url).searchParams.get('id'), null);
  if (!id) throw new HttpError('Ontbrekend nummer.');
  await requireRowCompany(env, data, 'stock_reasons', id);
  const gebruikt = await D.prepare('SELECT COUNT(*) AS n FROM stock_moves WHERE reason_id = ?1').bind(id).first();
  if (gebruikt && gebruikt.n > 0) {
    await D.prepare('UPDATE stock_reasons SET active = 0 WHERE id = ?1').bind(id).run();
    return json({ ok: true, archived: true, message: `Reden op non-actief gezet (${gebruikt.n} bewegingen verwijzen ernaar).` });
  }
  await D.prepare('DELETE FROM stock_reasons WHERE id = ?1').bind(id).run();
  return json({ ok: true });
});
