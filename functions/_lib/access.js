/**
 * Wie mag welk bedrijf zien of beheren.
 *
 * Dat hangt volledig af van de toegangscode waarmee de browser binnen is (zie _lib/pin.js):
 *
 *   code zonder bedrijf, rol 'beheerder'   → alles zien en beheren, ook bedrijven aanmaken
 *   code zonder bedrijf, rol 'teller'      → alle bedrijven zien en tellen, niets beheren
 *   code voor één bedrijf, rol 'beheerder' → dat ene bedrijf zien, tellen en beheren
 *   code voor één bedrijf, rol 'teller'    → dat ene bedrijf zien en tellen
 *
 * Staat er geen enkele code ingesteld, dan is er niets om aan te toetsen en mag alles — dat is
 * de toestand bij een verse installatie en bij lokaal ontwikkelen.
 */
import { HttpError } from './http.js';

export const ROLES = ['teller', 'beheerder'];

/**
 * De rechten van deze aanvraag:
 *
 *   viewAll        ziet álle bedrijven
 *   manageAll      beheert álle bedrijven
 *   canAdminister  mag bedrijven aanmaken en de toegangscodes beheren
 *   companies      de bedrijven waar deze code bij mag (leeg = alles, zie viewAll)
 *   code           de toegangscode waarmee deze browser binnen is (of null)
 */
export async function scopeFor(D, user) {
  const code = user && user.code;
  if (!code) {
    // geen code ingesteld: niets om aan te toetsen
    return { open: true, viewAll: true, manageAll: true, canAdminister: true, companies: new Set(), role: 'beheerder', code: null };
  }
  const mag = code.role === 'beheerder';
  const info = {
    label: code.label,
    role: code.role,
    company_id: code.company_id ?? null,
    company_name: code.company_name || null,
  };
  if (code.company_id) {
    return {
      open: false, viewAll: false, manageAll: false, canAdminister: false,
      companies: new Set([Number(code.company_id)]), role: code.role, code: info,
    };
  }
  return {
    open: false, viewAll: true, manageAll: mag, canAdminister: mag,
    companies: new Set(), role: code.role, code: info,
  };
}

export const mayView = (scope, companyId) =>
  scope.viewAll || scope.companies.has(Number(companyId));

export const mayManage = (scope, companyId) =>
  scope.manageAll || (scope.companies.has(Number(companyId)) && scope.role === 'beheerder');

/** Bedrijven filteren op wat deze code mag zien. */
export const visibleCompanies = (scope, companies) =>
  scope.viewAll ? companies : companies.filter((c) => scope.companies.has(c.id));

/** Gooit een nette 403 als het niet mag. `manage: true` vraagt beheerrechten. */
export function requireCompany(scope, companyId, { manage = false } = {}) {
  const id = Number(companyId);
  if (!id) throw new HttpError('Kies eerst een bedrijf.');
  if (!mayView(scope, id)) throw new HttpError('Deze toegangscode geeft geen toegang tot dit bedrijf.', 403);
  if (manage && !mayManage(scope, id)) {
    throw new HttpError('Deze toegangscode is enkel om te tellen. Gebruik de code met volledige toegang.', 403);
  }
  return id;
}

/** Bedrijven aanmaken en de toegangscodes beheren: enkel een code met volledige toegang. */
export function requireSuperAdmin(scope) {
  if (scope.canAdminister) return;
  throw new HttpError('Hiervoor heb je de code met volledige toegang nodig.', 403);
}

/** Het bedrijf achter een telling, met de rechtencontrole erbij. */
export async function companyOfCount(D, countId) {
  const row = await D.prepare('SELECT company_id FROM counts WHERE id = ?1').bind(Number(countId)).first();
  if (!row) throw new HttpError('Telling niet gevonden.', 404);
  return row.company_id;
}
