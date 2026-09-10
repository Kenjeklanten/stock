/**
 * POST /api/admin/sort   { table: 'companies' | 'locations' | 'suppliers' | 'products', ids: [...] }
 *
 * De volgorde van een lijst in één keer vastleggen: het eerste nummer krijgt volgorde 1, het
 * tweede 2, enzovoort. Zo hoeft er nergens nog een volgordekolom ingevuld te worden — je sleept
 * de rijen op hun plaats en dit zet de cijfers.
 */
import { json, handler, db, body, int, HttpError } from '../../_lib/http.js';
import { guard, requireCompany, requireSuperAdmin } from './_guard.js';

const TABELLEN = new Set(['companies', 'locations', 'suppliers', 'products']);

export const onRequestPost = handler(async ({ request, env, data }) => {
  const D = db(env);
  const input = (await body(request)) || {};
  const tabel = String(input.table || '');
  if (!TABELLEN.has(tabel)) throw new HttpError('Onbekende lijst.');

  const ids = (Array.isArray(input.ids) ? input.ids : []).map((v) => int(v, null)).filter(Boolean);
  if (!ids.length) throw new HttpError('Geen volgorde meegegeven.');

  const scope = await guard(env, data);
  if (tabel === 'companies') {
    requireSuperAdmin(scope);
  } else {
    // alle rijen moeten bij hetzelfde bedrijf horen, en dat bedrijf moet je mogen beheren
    const rows = await D.prepare(
      `SELECT DISTINCT company_id FROM ${tabel} WHERE id IN (${ids.map((_, i) => `?${i + 1}`).join(', ')})`
    ).bind(...ids).all();
    const bedrijven = (rows.results || []).map((r) => r.company_id);
    if (bedrijven.length !== 1) throw new HttpError('Die rijen horen niet bij hetzelfde bedrijf.', 400);
    requireCompany(scope, bedrijven[0], { manage: true });
  }

  const update = D.prepare(`UPDATE ${tabel} SET sort = ?2 WHERE id = ?1`);
  const statements = ids.map((id, i) => update.bind(id, i + 1));
  for (let i = 0; i < statements.length; i += 50) await D.batch(statements.slice(i, i + 50));
  return json({ ok: true, sorted: ids.length });
});
