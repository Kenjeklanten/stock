/**
 * Wie mag welk bedrijf zien of beheren.
 *
 * Zolang de tabel `members` leeg is, mag iedereen met een Access-sessie alles — zo kan een
 * verse installatie niet dichtklappen. Zodra er één lid in staat, geldt:
 *
 *   hoofdbeheerder (adres staat in ADMIN_EMAILS) → alles zien en beheren, ook bedrijven aanmaken
 *   beheerder van een bedrijf                    → dat bedrijf zien, tellen én de catalogus beheren
 *   teller van een bedrijf                       → dat bedrijf zien en tellen
 *
 * Daarbovenop komt de toegangscode waarmee de browser binnen is (zie _lib/pin.js). Die kan de
 * rechten enkel versmallen, nooit verruimen: een code voor 'tellen bij STVV' laat alleen STVV
 * zien en houdt het beheer dicht, ook als de aangemelde persoon eigenlijk meer mag.
 */
import { HttpError } from './http.js';

export const ROLES = ['teller', 'beheerder'];

/**
 * Leest de rechten van de aangemelde persoon; het resultaat past in één aanvraag.
 *
 *   open           niets ingesteld (geen leden én geen ADMIN_EMAILS) → iedereen mag alles
 *   viewAll        ziet álle bedrijven
 *   manageAll      beheert álle bedrijven
 *   superAdmin     beide: het klassieke hoofdbeheerder-recht
 *   canAdminister  mag bedrijven aanmaken en de algemene instellingen wijzigen; zonder
 *                  ADMIN_EMAILS mag een beheerder van een bedrijf dat ook, anders zou
 *                  niemand er nog bij kunnen
 *   roles          rol per bedrijf uit de tabel members
 *   code           de toegangscode waarmee deze browser binnen is (of null)
 */
export async function scopeFor(D, user) {
  return byCode(await byIdentity(D, user), user && user.code);
}

async function byIdentity(D, user) {
  const email = String((user && user.email) || '').toLowerCase();
  // Draait de tool niet achter Access, dan is er geen identiteit om rechten aan te hangen
  // (lokaal ontwikkelen). Dan staat alles open — de waarschuwing daarover staat in de kop.
  if (user && user.protected === false) {
    return { email, configured: false, viewAll: true, manageAll: true, superAdmin: true, canAdminister: true, roles: new Map(), open: true };
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
  return { email, configured, viewAll: superAdmin, manageAll: superAdmin, superAdmin, canAdminister, roles, open };
}

/**
 * De toegangscode erover leggen. Een code zonder bedrijf laat alles staan wat de aanmelding al
 * toeliet; een code mét bedrijf houdt daar precies één bedrijf van over. Rol 'teller' neemt
 * overal het beheer weg.
 */
function byCode(scope, code) {
  if (!code) return { ...scope, code: null };
  const mayManage = code.role === 'beheerder';
  const info = { label: code.label, role: code.role, company_id: code.company_id ?? null, company_name: code.company_name || null };

  if (code.company_id) {
    const id = Number(code.company_id);
    const allowed = scope.viewAll || scope.roles.has(id);       // de code verruimt niets
    const role = mayManage && (scope.manageAll || scope.roles.get(id) === 'beheerder') ? 'beheerder' : 'teller';
    return {
      ...scope, code: info, open: false, viewAll: false, manageAll: false, superAdmin: false,
      canAdminister: false, roles: allowed ? new Map([[id, role]]) : new Map(),
    };
  }
  if (mayManage) return { ...scope, code: info };
  // enkel tellen: dezelfde bedrijven, maar nergens beheerrechten
  return {
    ...scope, code: info, manageAll: false, superAdmin: false, canAdminister: false,
    roles: new Map([...scope.roles.keys()].map((id) => [id, 'teller'])),
  };
}

export const mayView = (scope, companyId) =>
  scope.viewAll || scope.roles.has(Number(companyId));

export const mayManage = (scope, companyId) =>
  scope.manageAll || scope.roles.get(Number(companyId)) === 'beheerder';

/** Bedrijven filteren op wat deze persoon mag zien. */
export const visibleCompanies = (scope, companies) =>
  scope.viewAll ? companies : companies.filter((c) => scope.roles.has(c.id));

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
  if (scope.code && scope.code.role !== 'beheerder') {
    throw new HttpError('Deze toegangscode is enkel om te tellen. Gebruik de code met volledige toegang.', 403);
  }
  throw new HttpError('Alleen een hoofdbeheerder kan dit doen.', 403);
}

/** Het bedrijf achter een telling, met de rechtencontrole erbij. */
export async function companyOfCount(D, countId) {
  const row = await D.prepare('SELECT company_id FROM counts WHERE id = ?1').bind(Number(countId)).first();
  if (!row) throw new HttpError('Telling niet gevonden.', 404);
  return row.company_id;
}
