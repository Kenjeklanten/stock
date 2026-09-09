/**
 * Wie mag welk bedrijf zien of beheren.
 *
 * Zolang de tabel `members` leeg is, mag iedereen met een Access-sessie alles — zo kan een
 * verse installatie niet dichtklappen. Zodra er één lid in staat, geldt:
 *
 *   hoofdbeheerder (adres staat in ADMIN_EMAILS) → alles zien en beheren, ook bedrijven aanmaken
 *   beheerder van een bedrijf                    → dat bedrijf zien, tellen én de catalogus beheren
 *   teller van een bedrijf                       → dat bedrijf zien en tellen
 */
import { HttpError } from './http.js';

export const ROLES = ['teller', 'beheerder'];

/**
 * Leest de rechten van de aangemelde persoon; het resultaat past in één aanvraag.
 *
 *   open           niets ingesteld (geen leden én geen ADMIN_EMAILS) → iedereen mag alles
 *   superAdmin     ziet en beheert álle bedrijven: staat in ADMIN_EMAILS (of alles staat open)
 *   canAdminister  mag bedrijven aanmaken en de algemene instellingen wijzigen; zonder
 *                  ADMIN_EMAILS mag een beheerder van een bedrijf dat ook, anders zou
 *                  niemand er nog bij kunnen
 *   roles          rol per bedrijf uit de tabel members
 */
export async function scopeFor(D, user) {
  const email = String((user && user.email) || '').toLowerCase();
  // Draait de tool niet achter Access, dan is er geen identiteit om rechten aan te hangen
  // (lokaal ontwikkelen). Dan staat alles open — de waarschuwing daarover staat in de kop.
  if (user && user.protected === false) {
    return { email, configured: false, superAdmin: true, canAdminister: true, roles: new Map(), open: true };
  }
  const rows = await D.prepare('SELECT email, company_id, role FROM members').all();
  const members = rows.results || [];
  const configured = members.length > 0;
  const listSet = !!(user && user.admin_list_set);
  const roles = new Map(members
    .filter((m) => String(m.email).toLowerCase() === email)
    .map((m) => [m.company_id, m.role]));
  const open = !configured && !listSet;
  const superAdmin = listSet ? !!(user && user.admin_listed) : open;
  const canAdminister = superAdmin || (!listSet && [...roles.values()].includes('beheerder'));
  return { email, configured, superAdmin, canAdminister, roles, open };
}

export const mayView = (scope, companyId) =>
  scope.open || scope.superAdmin || scope.roles.has(Number(companyId));

export const mayManage = (scope, companyId) =>
  scope.open || scope.superAdmin || scope.roles.get(Number(companyId)) === 'beheerder';

/** Bedrijven filteren op wat deze persoon mag zien. */
export const visibleCompanies = (scope, companies) =>
  (scope.open || scope.superAdmin) ? companies : companies.filter((c) => scope.roles.has(c.id));

/** Gooit een nette 403 als het niet mag. `manage: true` vraagt beheerrechten. */
export function requireCompany(scope, companyId, { manage = false } = {}) {
  const id = Number(companyId);
  if (!id) throw new HttpError('Kies eerst een bedrijf.');
  if (!mayView(scope, id)) throw new HttpError('Je hebt geen toegang tot dit bedrijf.', 403);
  if (manage && !mayManage(scope, id)) throw new HttpError('Je mag dit bedrijf niet beheren; vraag het aan een beheerder.', 403);
  return id;
}

/** Bedrijven aanmaken en de algemene instellingen: hoofdbeheerder (of, zonder ADMIN_EMAILS, een beheerder). */
export function requireSuperAdmin(scope) {
  if (scope.canAdminister) return;
  throw new HttpError('Alleen een hoofdbeheerder kan dit doen.', 403);
}

/** Het bedrijf achter een telling, met de rechtencontrole erbij. */
export async function companyOfCount(D, countId) {
  const row = await D.prepare('SELECT company_id FROM counts WHERE id = ?1').bind(Number(countId)).first();
  if (!row) throw new HttpError('Telling niet gevonden.', 404);
  return row.company_id;
}
