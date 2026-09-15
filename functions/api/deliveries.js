/**
 * GET /api/deliveries?company_id=1
 *
 * De leveringen van een bedrijf: wat er besteld is en nog nagekeken moet worden, en wat er
 * al nagekeken is. Een "levering" is hier de bestelling die uit één telling volgde — daar
 * hangen de bestelde aantallen aan waar je de geleverde tegen afzet.
 */
import { json, handler, db, int, HttpError } from '../_lib/http.js';
import { scopeFor, requireCompany, visibleCompanies } from '../_lib/access.js';
import { openLeveringen, nagekekenLeveringen } from '../_lib/delivery.js';

export const onRequestGet = handler(async ({ request, env, data }) => {
  const D = db(env);
  const url = new URL(request.url);
  const scope = await scopeFor(D, data.user);

  let companyId = int(url.searchParams.get('company_id'), null);
  if (!companyId) {
    const companies = await D.prepare('SELECT id, name FROM companies WHERE active = 1 ORDER BY sort, name').all();
    const first = visibleCompanies(scope, companies.results || [])[0];
    if (!first) throw new HttpError('Er is nog geen bedrijf om te tonen.', 404);
    companyId = first.id;
  }
  requireCompany(scope, companyId);

  const [open, done] = await Promise.all([
    openLeveringen(D, companyId),
    nagekekenLeveringen(D, companyId),
  ]);
  return json({ company_id: companyId, open, done });
});
