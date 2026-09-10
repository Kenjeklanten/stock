/**
 * Handmatige stockbewegingen: drank die uit de stock gaat of erbij komt zonder telling of
 * levering — voor het Rode Kruis, voor de bussen, breuk, personeel, een verhuis tussen togen.
 *
 * GET    /api/moves?company_id=&location_id=&product_id=&limit=
 * POST   /api/moves   { location_id, product_id, qty, reason_id, note, moved_on }
 *                     qty positief = erbij, negatief = eruit
 * DELETE /api/moves?id=
 *
 * Bewegingen inboeken mag iedereen die de locatie mag tellen: het gebeurt aan de toog, op het
 * moment zelf. Verwijderen vraagt beheerrechten — een boeking rechtzetten doe je met een
 * tegenboeking, zodat de tijdlijn blijft kloppen.
 */
import { json, handler, db, body, int, num, text, isDate, today, HttpError } from '../_lib/http.js';
import { scopeFor, requireCompany } from '../_lib/access.js';

export const onRequestGet = handler(async ({ request, env, data }) => {
  const D = db(env);
  const url = new URL(request.url);
  const scope = await scopeFor(D, data.user);
  const companyId = int(url.searchParams.get('company_id'), null);
  requireCompany(scope, companyId);

  const args = [companyId];
  const where = ['m.company_id = ?1'];
  for (const [veld, kolom] of [['location_id', 'm.location_id'], ['product_id', 'm.product_id']]) {
    const waarde = int(url.searchParams.get(veld), null);
    if (waarde) { args.push(waarde); where.push(`${kolom} = ?${args.length}`); }
  }
  const limit = Math.min(Math.max(int(url.searchParams.get('limit'), 100), 1), 500);
  args.push(limit);

  const rows = await D.prepare(
    `SELECT m.id, m.location_id, l.name AS location_name, m.product_id, p.name AS product_name,
            p.unit, m.qty, m.note, m.moved_on, m.created_by, m.created_at,
            m.reason_id, r.name AS reason_name
       FROM stock_moves m
       JOIN locations l      ON l.id = m.location_id
       LEFT JOIN products p  ON p.id = m.product_id
       LEFT JOIN stock_reasons r ON r.id = m.reason_id
      WHERE ${where.join(' AND ')}
      ORDER BY m.moved_on DESC, m.id DESC LIMIT ?${args.length}`
  ).bind(...args).all();
  return json({ moves: rows.results || [] });
});

export const onRequestPost = handler(async ({ request, env, data }) => {
  const D = db(env);
  const input = (await body(request)) || {};
  const locationId = int(input.location_id, null);
  const productId = int(input.product_id, null);
  const qty = num(input.qty, null);
  if (!locationId || !productId) throw new HttpError('Kies een locatie en een product.');
  if (qty === null || qty === 0) throw new HttpError('Vul in hoeveel er bij- of afgaat.');

  const plek = await D.prepare(
    `SELECT l.id, l.company_id FROM locations l WHERE l.id = ?1`
  ).bind(locationId).first();
  if (!plek) throw new HttpError('Onbekende locatie.', 404);
  requireCompany(await scopeFor(D, data.user), plek.company_id);

  const product = await D.prepare('SELECT id FROM products WHERE id = ?1 AND company_id = ?2')
    .bind(productId, plek.company_id).first();
  if (!product) throw new HttpError('Dat product hoort niet bij dit bedrijf.', 400);

  let reasonId = int(input.reason_id, null);
  if (reasonId) {
    const reden = await D.prepare('SELECT id FROM stock_reasons WHERE id = ?1 AND company_id = ?2')
      .bind(reasonId, plek.company_id).first();
    if (!reden) throw new HttpError('Onbekende reden.', 400);
  } else {
    reasonId = null;
  }

  const res = await D.prepare(
    `INSERT INTO stock_moves (company_id, location_id, product_id, reason_id, qty, note, moved_on, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(
    plek.company_id, locationId, productId, reasonId, qty, text(input.note, 200),
    isDate(input.moved_on) ? input.moved_on : today(),
    text((data.user && data.user.email) || '', 160),
  ).run();
  return json({ id: res.meta.last_row_id }, 201);
});

export const onRequestDelete = handler(async ({ request, env, data }) => {
  const D = db(env);
  const id = int(new URL(request.url).searchParams.get('id'), null);
  if (!id) throw new HttpError('Ontbrekend nummer.');
  const rij = await D.prepare('SELECT company_id FROM stock_moves WHERE id = ?1').bind(id).first();
  if (!rij) throw new HttpError('Die beweging bestaat niet.', 404);
  requireCompany(await scopeFor(D, data.user), rij.company_id, { manage: true });
  await D.prepare('DELETE FROM stock_moves WHERE id = ?1').bind(id).run();
  return json({ ok: true });
});
