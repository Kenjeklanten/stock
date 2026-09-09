/**
 * Toegangscodes: korte cijfercodes die vóór de hele tool zitten, los van Cloudflare Access.
 *
 * Elke code draagt haar eigen rechten (tabel `access_codes`), dus ze bepaalt niet alleen óf
 * je binnen mag maar ook wat je mag:
 *
 *   1011  volledige toegang        role 'beheerder', geen bedrijf → alles
 *   8956  tellen bij STVV          role 'teller', bedrijf STVV    → enkel tellen daar
 *
 * Met de omgevingsvariabele APP_PIN kan er altijd een code met volledige toegang bijgezet
 * worden; handig als je jezelf per ongeluk buitensluit. Staat er geen enkele actieve code,
 * dan wordt er niets gevraagd.
 *
 * Na het invoeren krijgt de browser een cookie die dertig dagen meegaat. Die draagt enkel een
 * vervaldatum, een kenmerk van de code en een handtekening (HMAC met de code als sleutel) —
 * de code zelf staat er niet in, en de cookie is waardeloos zodra de code verandert.
 */
const COOKIE = 'bestel_code';
const DAYS = 30;

const bytes = (s) => new TextEncoder().encode(s);
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Kort, niet terug te rekenen kenmerk van een code; dat staat in de cookie. */
export async function codeId(code) {
  return (await crypto.subtle.digest('SHA-256', bytes(`id:${code}`)).then(hex)).slice(0, 16);
}

async function sign(code, payload, env) {
  const key = await crypto.subtle.importKey(
    'raw', bytes(`${code}:${env.PIN_SALT || 'besteltool'}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, bytes(payload)));
}

/** Alle codes die nu geldig zijn: die uit de databank plus APP_PIN. */
export async function activeCodes(env, D) {
  const codes = [];
  const fixed = String(env.APP_PIN || '').trim();
  if (fixed) codes.push({ code: fixed, label: 'Noodcode (APP_PIN)', role: 'beheerder', company_id: null, fixed: true });
  try {
    const rows = await D.prepare(
      `SELECT a.code, a.label, a.role, a.company_id, c.name AS company_name
         FROM access_codes a LEFT JOIN companies c ON c.id = a.company_id
        WHERE a.active = 1 ORDER BY a.company_id IS NOT NULL, a.label`
    ).all();
    for (const row of rows.results || []) codes.push({ ...row, fixed: false });
  } catch { /* tabel bestaat nog niet: enkel APP_PIN telt dan */ }
  return codes;
}

/** Zoekt de ingevoerde code op; vergelijking in vaste tijd. */
export async function matchCode(codes, entered) {
  const given = String(entered || '').trim();
  let found = null;
  for (const candidate of codes) {
    let diff = candidate.code.length ^ given.length;
    for (let i = 0; i < Math.max(candidate.code.length, given.length); i++) {
      diff |= (candidate.code.charCodeAt(i) || 0) ^ (given.charCodeAt(i) || 0);
    }
    if (diff === 0 && !found) found = candidate;
  }
  return found;
}

export function readCookie(request, name = COOKIE) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Welke code zit er achter deze browser? Geeft de rij uit `access_codes` terug, of null als
 * de cookie ontbreekt, vervallen is, of bij geen enkele geldige code meer past.
 */
export async function sessionCode(request, codes, env) {
  const value = readCookie(request);
  if (!value) return null;
  const [expires, id, mac] = value.split('.');
  if (!expires || !id || !mac) return null;
  if (Number(expires) < Date.now()) return null;
  for (const candidate of codes) {
    if ((await codeId(candidate.code)) !== id) continue;
    const expected = await sign(candidate.code, `${expires}.${id}`, env);
    if (expected.length !== mac.length) return null;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
    return diff === 0 ? candidate : null;
  }
  return null;
}

/** De Set-Cookie-kop na een juiste code. */
export async function grantCookie(code, env) {
  const expires = Date.now() + DAYS * 24 * 60 * 60 * 1000;
  const id = await codeId(code);
  const value = `${expires}.${id}.${await sign(code, `${expires}.${id}`, env)}`;
  return `${COOKIE}=${value}; Path=/; Max-Age=${DAYS * 24 * 60 * 60}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** Codes zijn kort; deze teller houdt brute kracht binnen de perken (per isolate). */
const attempts = new Map();
export function tooManyAttempts(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > 10;
}
