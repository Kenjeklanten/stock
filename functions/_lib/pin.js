/**
 * Toegangscode: een korte cijfercode die vóór alles zit, los van Cloudflare Access.
 *
 * De code staat in de tabel `settings` (sleutel `pin`) en is aanpasbaar in Beheer →
 * Instellingen; met de omgevingsvariabele APP_PIN kan ze ook vastgezet worden. Is er geen
 * code ingesteld, dan wordt er niets gevraagd.
 *
 * Na het invoeren krijgt de browser een cookie die dertig dagen meegaat. Die cookie draagt
 * enkel een vervaldatum plus een handtekening (HMAC met de code als sleutel), dus ze is
 * waardeloos zodra de code verandert.
 */
const COOKIE = 'bestel_code';
const DAYS = 30;

export async function activePin(env, D) {
  const fixed = String(env.APP_PIN || '').trim();
  if (fixed) return fixed;
  try {
    const row = await D.prepare("SELECT value FROM settings WHERE key = 'pin'").first();
    return String((row && row.value) || '').trim();
  } catch {
    return '';
  }
}

const bytes = (s) => new TextEncoder().encode(s);

async function sign(pin, payload, env) {
  const key = await crypto.subtle.importKey(
    'raw', bytes(`${pin}:${env.PIN_SALT || 'besteltool'}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, bytes(payload));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function readCookie(request, name = COOKIE) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Klopt de cookie bij deze code en is ze nog geldig? */
export async function unlocked(request, pin, env) {
  const value = readCookie(request);
  if (!value) return false;
  const [expires, mac] = value.split('.');
  if (!expires || !mac) return false;
  if (Number(expires) < Date.now()) return false;
  const expected = await sign(pin, expires, env);
  // vergelijking in vaste tijd
  if (expected.length !== mac.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
  return diff === 0;
}

/** De Set-Cookie-kop na een juiste code. */
export async function grantCookie(pin, env) {
  const expires = Date.now() + DAYS * 24 * 60 * 60 * 1000;
  const value = `${expires}.${await sign(pin, String(expires), env)}`;
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
