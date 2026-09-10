import { json, handler, db, body, int, text, isDate, today, HttpError } from '../_lib/http.js';
import { saveLines } from '../_lib/store.js';
import { scopeFor, requireCompany, visibleCompanies } from '../_lib/access.js';

/** GET /api/counts?company_id=&location_id=&limit= — overzicht van tellingen. */
export const onRequestGet = handler(async ({ request, env, data }) => {
  const D = db(env);
  const url = new URL(request.url);
  const companyId = int(url.searchParams.get('company_id'), null);
  const locationId = int(url.searchParams.get('location_id'), null);
  const limit = Math.min(Math.max(int(url.searchParams.get('limit'), 50), 1), 200);
  const scope = await scopeFor(D, data.user);

  const where = [];
  const args = [limit];
  if (companyId) {
    requireCompany(scope, companyId);
    args.push(companyId);
    where.push(`c.company_id = ?${args.length}`);
  } else if (!scope.viewAll) {
    // zonder gekozen bedrijf: enkel de bedrijven waar deze code bij mag
    const ids = [...scope.companies];
    if (!ids.length) return json({ counts: [] });
    where.push(`c.company_id IN (${ids.map((id) => Number(id)).join(', ')})`);
  }
  if (locationId) { args.push(locationId); where.push(`c.location_id = ?${args.length}`); }

  const rows = await D.prepare(
    `SELECT c.id, c.company_id, co.name AS company_name, c.location_id, l.name AS location_name,
            c.counted_on, c.status, c.note, c.created_by, c.created_at, c.ordered_at,
            (SELECT COUNT(*) FROM count_lines cl WHERE cl.count_id = c.id AND cl.counted_qty IS NOT NULL) AS counted_lines,
            (SELECT COUNT(*) FROM count_lines cl WHERE cl.count_id = c.id AND cl.order_qty > 0) AS order_lines
       FROM counts c
       JOIN locations l  ON l.id = c.location_id
       JOIN companies co ON co.id = c.company_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.counted_on DESC, c.id DESC LIMIT ?1`
  ).bind(...args).all();
  return json({ counts: rows.results || [] });
});

/** POST /api/counts — nieuwe telling opslaan. Het bedrijf volgt uit de locatie. */
export const onRequestPost = handler(async ({ request, env, data }) => {
  const D = db(env);
  const input = await body(request);
  if (!input) throw new HttpError('Ongeldige aanvraag.');

  const locationId = int(input.location_id, null);
  if (!locationId) throw new HttpError('Kies een locatie.');
  const location = await D.prepare('SELECT id, company_id FROM locations WHERE id = ?1').bind(locationId).first();
  if (!location) throw new HttpError('Onbekende locatie.', 404);
  requireCompany(await scopeFor(D, data.user), location.company_id);

  const countedOn = isDate(input.counted_on) ? input.counted_on : today();
  const note = text(input.note, 500);
  const by = text(input.created_by || (data.user && data.user.email) || '', 160);

  const res = await D.prepare(
    'INSERT INTO counts (company_id, location_id, counted_on, note, created_by) VALUES (?1, ?2, ?3, ?4, ?5)'
  ).bind(location.company_id, locationId, countedOn, note, by).run();
  const id = res.meta.last_row_id;

  await saveLines(D, id, locationId, input.lines);
  return json({ id }, 201);
});
