/**
 * Wie komt er binnen, en als wie?
 *
 * Er zijn twee deuren:
 *
 *   1. Een cijfercode (zie _lib/pin.js). Dat is de deur voor wie aan de toog telt: geen account
 *      nodig, en de code bepaalt meteen wat iemand mag.
 *   2. Een Google-account via Cloudflare Access, voor wie de tool beheert. Access laat enkel
 *      adressen van één domein door (ADMIN_DOMAIN, standaard kenjeklanten.be) en zet bij elk
 *      verzoek een ondertekende JWT in de cookie `CF_Authorization`. Die handtekening rekenen we
 *      hier zelf na, zodat het ook klopt als iemand het *.pages.dev-adres rechtstreeks probeert.
 *      Een geldige Access-sessie met zo'n adres geeft volledige toegang; er is dan geen code nodig.
 *
 * Access wordt aangezet op één enkel pad — /aanmelden. Wie daarheen gaat, krijgt het
 * aanmeldscherm van Google; de rest van de tool blijft bereikbaar met een code. Zo staat niemand
 * die enkel telt voor een gesloten deur.
 *
 * Variabelen (Cloudflare Pages → Settings → Variables and secrets):
 *   ACCESS_TEAM_DOMAIN  bv. "jeconcept.cloudflareaccess.com" — leeg = geen Google-aanmelding
 *   ACCESS_AUD          Application Audience (AUD) van de Access-applicatie op /aanmelden
 *   ADMIN_DOMAIN        het domein dat volledige toegang krijgt, standaard kenjeklanten.be
 */
import { json } from './_lib/http.js';
import { activeCodes, sessionCode } from './_lib/pin.js';

const CERTS_TTL_MS = 60 * 60 * 1000;
let certsCache = { at: 0, team: '', keys: null };

const b64url = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};
const jsonPart = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

async function jwks(team) {
  const now = Date.now();
  if (certsCache.keys && certsCache.team === team && now - certsCache.at < CERTS_TTL_MS) return certsCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } });
  if (!r.ok) throw new Error(`Access certs: HTTP ${r.status}`);
  const data = await r.json();
  certsCache = { at: now, team, keys: data.keys || [] };
  return certsCache.keys;
}

async function verifyToken(token, team, aud) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const header = jsonPart(parts[0]);
  const payload = jsonPart(parts[1]);
  const keys = await jwks(team);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
    b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now - 60) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  if (payload.iss && payload.iss !== `https://${team}`) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (aud && !auds.includes(aud)) return null;
  return payload;
}

function cookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * De toegangscode zit vóór alles. Wie ze nog niet gegeven heeft:
 *
 *   - een gewone paginaoproep gaat naar /login, met een spoor terug naar waar hij heen wilde;
 *   - een aanvraag naar /api/ krijgt 401 met code 'pin', zodat een scherm dat al openstaat
 *     zichzelf naar het aanmeldscherm stuurt;
 *   - het aanmeldscherm zelf, de stijlbestanden en de iconen blijven bereikbaar.
 *
 * Geeft { gate } terug als het verzoek geweigerd wordt, of { code } met de code waarmee deze
 * browser binnen is — die bepaalt verderop mee welke rechten er gelden.
 */
const OPEN_PADEN = ['/login', '/aanmelden', '/css/', '/js/', '/icon-', '/favicon.svg', '/manifest.webmanifest', '/sw.js'];

async function pinGate(request, env, url) {
  if (!env.DB) return {};
  const codes = await activeCodes(env, env.DB);
  if (!codes.length) return {};
  const code = await sessionCode(request, codes, env);
  if (code) return { code };

  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/pin') return {};
    return { gate: json({ error: 'Geef eerst de toegangscode van de besteltool.', code: 'pin' }, 401) };
  }
  if (OPEN_PADEN.some((pad) => url.pathname === pad || url.pathname.startsWith(pad))) return {};

  const wilPagina = (request.headers.get('accept') || '').includes('text/html');
  if (!wilPagina) return {};
  const terug = encodeURIComponent(url.pathname + url.search);
  return { gate: new Response(null, { status: 302, headers: { location: `/login?next=${terug}`, 'cache-control': 'no-store' } }) };
}

/** Het domein waarvan een Google-account volledige toegang krijgt. */
const beheerDomein = (env) => String(env.ADMIN_DOMAIN || 'kenjeklanten.be').trim().toLowerCase();

/**
 * Is er een geldige Access-sessie, en hoort het adres bij het beheerdersdomein?
 * Geeft het e-mailadres terug, of null. Een sessie van een ander domein telt niet mee: die
 * persoon valt gewoon terug op de cijfercode.
 */
async function accessBeheerder(request, env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!team) return null;
  const token = request.headers.get('cf-access-jwt-assertion') || cookie(request, 'CF_Authorization');
  if (!token) return null;
  let payload = null;
  try {
    payload = await verifyToken(token, team, env.ACCESS_AUD);
  } catch (err) {
    console.error('Access-verificatie mislukt:', err.message);
    return null;
  }
  if (!payload) return null;
  const email = String(payload.email || payload.common_name || '').toLowerCase();
  return email.endsWith(`@${beheerDomein(env)}`) ? email : null;
}

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);

  // Aangemeld met een Google-account van het beheerdersdomein: volledige toegang, geen code.
  const beheerder = await accessBeheerder(request, env);
  if (beheerder) {
    data.user = {
      email: beheerder,
      protected: true,
      admin_login: true,
      code: { label: beheerder, role: 'beheerder', company_id: null },
    };
    return next();
  }

  const { gate, code } = await pinGate(request, env, url);
  if (gate) return gate;
  data.user = {
    email: '',
    protected: false,
    admin_login: false,
    admin_login_available: !!env.ACCESS_TEAM_DOMAIN,
    admin_domain: beheerDomein(env),
    code: code || null,
  };
  return next();
}
