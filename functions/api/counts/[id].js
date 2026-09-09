import { json, handler, db, body, int, text, isDate, HttpError } from '../../_lib/http.js';
import { loadCount, saveLines, groupBySupplier } from '../../_lib/store.js';

const idOf = (params) => {
  const id = int(params.id, null);
  if (!id) throw new HttpError('Ongeldig nummer.', 400);
  return id;
};

/** GET /api/counts/:id — telling met alle regels en de bestelling per leverancier. */
export const onRequestGet = handler(async ({ params, env }) => {
  const D = db(env);
  const detail = await loadCount(D, idOf(params));
  return json({ ...detail, orders: groupBySupplier(detail.lines) });
});

/** PUT /api/counts/:id — telling bijwerken (datum, opmerking, getelde aantallen). */
export const onRequestPut = handler(async ({ params, request, env }) => {
  const D = db(env);
  const id = idOf(params);
  const input = await body(request);
  if (!input) throw new HttpError('Ongeldige aanvraag.');

  const count = await D.prepare('SELECT id, location_id, status FROM counts WHERE id = ?1').bind(id).first();
  if (!count) throw new HttpError('Telling niet gevonden.', 404);
  if (count.status === 'besteld') throw new HttpError('Deze telling is al besteld. Zet ze eerst terug op open.', 409);

  if (isDate(input.counted_on) || input.note !== undefined) {
    await D.prepare("UPDATE counts SET counted_on = COALESCE(?2, counted_on), note = COALESCE(?3, note), updated_at = datetime('now') WHERE id = ?1")
      .bind(id, isDate(input.counted_on) ? input.counted_on : null, input.note === undefined ? null : text(input.note, 500)).run();
  }
  if (Array.isArray(input.lines)) await saveLines(D, id, count.location_id, input.lines);

  const detail = await loadCount(D, id);
  return json({ ...detail, orders: groupBySupplier(detail.lines) });
});

/** PATCH /api/counts/:id — status wijzigen (open ⇄ besteld). */
export const onRequestPatch = handler(async ({ params, request, env }) => {
  const D = db(env);
  const id = idOf(params);
  const input = (await body(request)) || {};
  const status = input.status === 'besteld' ? 'besteld' : 'open';
  const res = await D.prepare(
    `UPDATE counts SET status = ?2, ordered_at = CASE WHEN ?2 = 'besteld' THEN datetime('now') ELSE NULL END,
            updated_at = datetime('now') WHERE id = ?1`
  ).bind(id, status).run();
  if (!res.meta.changes) throw new HttpError('Telling niet gevonden.', 404);
  return json({ id, status });
});

/** DELETE /api/counts/:id */
export const onRequestDelete = handler(async ({ params, env, data }) => {
  const D = db(env);
  if (data.user && !data.user.admin) throw new HttpError('Alleen een beheerder kan een telling verwijderen.', 403);
  const id = idOf(params);
  await D.prepare('DELETE FROM count_lines WHERE count_id = ?1').bind(id).run();
  const res = await D.prepare('DELETE FROM counts WHERE id = ?1').bind(id).run();
  if (!res.meta.changes) throw new HttpError('Telling niet gevonden.', 404);
  return json({ ok: true });
});
