import { json, handler, db, body, int, text, HttpError } from '../../_lib/http.js';
import { guard, requireSuperAdmin } from './_guard.js';
import { visibleCompanies, requireCompany } from '../../_lib/access.js';

/** Bedrijven: elk met eigen locaties, leveranciers en producten. De gegevens hier komen op de bestelbon. */
const fields = (input) => ({
  name: text(input.name, 80),
  sort: int(input.sort, 0),
  active: input.active === false ? 0 : 1,
});

export const onRequestGet = handler(async ({ env, data }) => {
  const rows = await db(env).prepare('SELECT * FROM companies ORDER BY sort, name').all();
  return json({ companies: visibleCompanies(await guard(env, data), rows.results || []) });
});

export const onRequestPost = handler(async ({ request, env, data }) => {
  requireSuperAdmin(await guard(env, data));
  const f = fields((await body(request)) || {});
  if (!f.name) throw new HttpError('Geef het bedrijf een naam.');
  try {
    const res = await db(env).prepare(
      'INSERT INTO companies (name, sort, active) VALUES (?1, ?2, ?3)'
    ).bind(f.name, f.sort, f.active).run();
    return json({ id: res.meta.last_row_id }, 201);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError('Er bestaat al een bedrijf met die naam.', 409);
    throw err;
  }
});

export const onRequestPut = handler(async ({ request, env, data }) => {
  const input = (await body(request)) || {};
  const id = int(input.id, null);
  if (!id) throw new HttpError('Ontbrekend nummer.');
  requireCompany(await guard(env, data), id, { manage: true });
  const f = fields(input);
  if (!f.name) throw new HttpError('Geef het bedrijf een naam.');
  const res = await db(env).prepare(
    'UPDATE companies SET name = ?2, sort = ?3, active = ?4 WHERE id = ?1'
  ).bind(id, f.name, f.sort, f.active).run();
  if (!res.meta.changes) throw new HttpError('Bedrijf niet gevonden.', 404);
  return json({ ok: true });
});

export const onRequestDelete = handler(async ({ request, env, data }) => {
  const D = db(env);
  const id = int(new URL(request.url).searchParams.get('id'), null);
  if (!id) throw new HttpError('Ontbrekend nummer.');
  const scope = await guard(env, data);
  requireSuperAdmin(scope);
  requireCompany(scope, id, { manage: true });
  const used = await D.prepare('SELECT COUNT(*) AS n FROM counts WHERE company_id = ?1').bind(id).first();
  if (used && used.n > 0) {
    await D.prepare('UPDATE companies SET active = 0 WHERE id = ?1').bind(id).run();
    return json({ ok: true, archived: true, message: `Bedrijf is op non-actief gezet (er zijn ${used.n} tellingen aan gekoppeld).` });
  }
  // Zonder tellingen mag het bedrijf weg; locaties, leveranciers en producten volgen (ON DELETE CASCADE).
  await D.prepare('DELETE FROM companies WHERE id = ?1').bind(id).run();
  return json({ ok: true });
});
