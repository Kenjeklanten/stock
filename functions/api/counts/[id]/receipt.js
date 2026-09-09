/**
 * Ontvangstcontrole: wat is er effectief geleverd?
 *
 * PUT /api/counts/:id/receipt
 *   { lines: [{ product_id, packs, loose }], complete: true|false }
 *
 * Per product wordt genoteerd wat er binnenkwam, in volle pakken + losse stuks — dezelfde
 * manier van tellen als bij de stocktelling zelf. `complete: true` zet de telling op
 * 'geleverd' en houdt bij wie ze wanneer heeft nagekeken.
 */
import { json, handler, db, body, int, HttpError } from '../../../_lib/http.js';
import { loadCount, saveReceipt, groupBySupplier } from '../../../_lib/store.js';
import { scopeFor, requireCompany, companyOfCount } from '../../../_lib/access.js';

export const onRequestPut = handler(async ({ params, request, env, data }) => {
  const D = db(env);
  const id = int(params.id, null);
  if (!id) throw new HttpError('Ongeldig nummer.', 400);
  requireCompany(await scopeFor(D, data.user), await companyOfCount(D, id));

  const input = (await body(request)) || {};
  await saveReceipt(D, id, input.lines, {
    complete: input.complete === true,
    by: (data.user && data.user.email) || '',
  });

  const detail = await loadCount(D, id);
  return json({ ...detail, orders: groupBySupplier(detail.lines) });
});
