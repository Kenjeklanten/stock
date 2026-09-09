import { json, handler, db, body, int, text, HttpError } from '../../_lib/http.js';
import { guard, requireCompany, requireRowCompany } from './_guard.js';

/** GET /api/admin/locations?company_id= */
export const onRequestGet = handler(async ({ request, env }) => {
  const companyId = int(new URL(request.url).searchParams.get('company_id'), null);
  const rows = companyId
    ? await db(env).prepare('SELECT * FROM locations WHERE company_id = ?1 ORDER BY sort, name').bind(companyId).all()
    : await db(env).prepare('SELECT * FROM locations ORDER BY company_id, sort, name').all();
  return json({ locations: rows.results || [] });
});

export const onRequestPost = handler(async ({ request, env, data }) => {
  const D = db(env);
  const input = (await body(request)) || {};
  const companyId = int(input.company_id, null);
  const name = text(input.name, 80);
  requireCompany(await guard(env, data), companyId, { manage: true });
  if (!name) throw new HttpError('Geef de locatie een naam.');
  try {
    const res = await D.prepare('INSERT INTO locations (company_id, name, sort, active) VALUES (?1, ?2, ?3, ?4)')
      .bind(companyId, name, int(input.sort, 0), input.active === false ? 0 : 1).run();
    return json({ id: res.meta.last_row_id }, 201);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError('Dit bedrijf heeft al een locatie met die naam.', 409);
    if (String(err.message).includes('FOREIGN KEY')) throw new HttpError('Onbekend bedrijf.', 400);
    throw err;
  }
});

export const onRequestPut = handler(async ({ request, env, data }) => {
  const input = (await body(request)) || {};
  const id = int(input.id, null);
  if (!id) throw new HttpError('Ontbrekend nummer.');
  await requireRowCompany(env, data, 'locations', id);
  const res = await db(env).prepare('UPDATE locations SET name = ?2, sort = ?3, active = ?4 WHERE id = ?1')
    .bind(id, text(input.name, 80), int(input.sort, 0), input.active === false ? 0 : 1).run();
  if (!res.meta.changes) throw new HttpError('Locatie niet gevonden.', 404);
  return json({ ok: true });
});

export const onRequestDelete = handler(async ({ request, env, data }) => {
  const D = db(env);
  const id = int(new URL(request.url).searchParams.get('id'), null);
  if (!id) throw new HttpError('Ontbrekend nummer.');
  await requireRowCompany(env, data, 'locations', id);
  const used = await D.prepare('SELECT COUNT(*) AS n FROM counts WHERE location_id = ?1').bind(id).first();
  if (used && used.n > 0) {
    await D.prepare('UPDATE locations SET active = 0 WHERE id = ?1').bind(id).run();
    return json({ ok: true, archived: true, message: `Locatie is op non-actief gezet (er zijn ${used.n} tellingen aan gekoppeld).` });
  }
  await D.prepare('DELETE FROM par_levels WHERE location_id = ?1').bind(id).run();
  await D.prepare('DELETE FROM locations WHERE id = ?1').bind(id).run();
  return json({ ok: true });
});
