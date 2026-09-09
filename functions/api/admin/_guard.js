import { HttpError, db, int } from '../../_lib/http.js';
import { scopeFor, requireCompany, requireSuperAdmin } from '../../_lib/access.js';

/** Rechten voor een beheerscherm: geeft het scope-object terug. */
export const guard = async (env, data) => scopeFor(db(env), data.user);

/** Het bedrijf waar een rij bij hoort, en meteen de controle of je die mag beheren. */
export async function requireRowCompany(env, data, table, id) {
  const D = db(env);
  const row = await D.prepare(`SELECT company_id FROM ${table} WHERE id = ?1`).bind(int(id, 0)).first();
  if (!row) throw new HttpError('Niet gevonden.', 404);
  requireCompany(await scopeFor(D, data.user), row.company_id, { manage: true });
  return row.company_id;
}

export { requireCompany, requireSuperAdmin, scopeFor };
