/**
 * Toegangscontrole voor de volledige besteltool (ook de HTML-pagina's).
 *
 * De tool hoort achter een Cloudflare Access-policy (Zero Trust) te staan. Access zet dan bij
 * elk verzoek een JWT in de cookie `CF_Authorization` / header `Cf-Access-Jwt-Assertion`.
 * Deze middleware verifieert die handtekening zelf, zodat de app ook veilig blijft als iemand
 * het onderliggende *.pages.dev-adres rechtstreeks probeert te bereiken.
 *
 * Variabelen (Cloudflare Pages → Settings → Variables and secrets):
 *   ACCESS_TEAM_DOMAIN  bv. "jeconcept.cloudflareaccess.com"   → zonder deze variabele draait de tool open (enkel voor lokaal testen)
 *   ACCESS_AUD          Application Audience (AUD) tag van de Access-applicatie
 *   ADMIN_EMAILS        komma-gescheiden lijst; leeg = iedereen met toegang mag beheren
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
 * ADMIN_EMAILS bepaalt de hoofdbeheerders: die mogen overal aan, ook bedrijven beheren.
 * Staat de lijst leeg, dan mag iedereen met toegang alles — tenzij de tabel `members`
 * ingevuld is; dat wordt per aanvraag bekeken in _lib/access.js.
 */
const adminFlags = (email, env) => {
  const list = String(env.ADMIN_EMAILS || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
  const listed = list.includes(String(email || '').toLowerCase());
  return { admin: list.length === 0 || listed, admin_listed: listed, admin_list_set: list.length > 0 };
};

/**
 * De toegangscode zit vóór de API. De pagina's zelf laden wel, maar tonen zonder code niets:
 * elke aanvraag naar /api/ geeft 401 met code 'pin', waarna het scherm om de cijfers vraagt.
 *
 * Geeft { gate } terug als het verzoek geweigerd wordt, of { code } met de code waarmee deze
 * browser binnen is — die bepaalt verderop mee welke rechten er gelden.
 */
async function pinGate(request, env, url) {
  if (!env.DB) return {};
  const codes = await activeCodes(env, env.DB);
  if (!codes.length) return {};
  const code = await sessionCode(request, codes, env);
  if (code) return { code };
  if (!url.pathname.startsWith('/api/') || url.pathname === '/api/pin') return {};
  return { gate: json({ error: 'Geef eerst de toegangscode van de besteltool.', code: 'pin' }, 401) };
}

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);
  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

  if (!team) {
    // Geen Access geconfigureerd: enkel de toegangscode beschermt de tool.
    const { gate, code } = await pinGate(request, env, url);
    if (gate) return gate;
    data.user = {
      email: request.headers.get('cf-access-authenticated-user-email') || '',
      admin: true, admin_listed: false, admin_list_set: false, protected: false, code: code || null,
    };
    return next();
  }

  const token = request.headers.get('cf-access-jwt-assertion') || cookie(request, 'CF_Authorization');
  let payload = null;
  try {
    if (token) payload = await verifyToken(token, team, env.ACCESS_AUD);
  } catch (err) {
    console.error('Access-verificatie mislukt:', err.message);
  }

  if (!payload) {
    const message = 'Geen geldige Cloudflare Access-sessie. Meld je aan via het beveiligde adres van de besteltool.';
    if (url.pathname.startsWith('/api/')) return json({ error: message }, 403);
    return new Response(
      `<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Geen toegang — Besteltool</title><style>body{font:16px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#0f172a;color:#e2e8f0}` +
      `div{max-width:32rem;padding:2rem;text-align:center}a{color:#7dd3fc}</style><div><h1>Geen toegang</h1><p>${message}</p></div></html>`,
      { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }

  const { gate, code } = await pinGate(request, env, url);
  if (gate) return gate;

  const email = payload.email || payload.common_name || '';
  data.user = { email, ...adminFlags(email, env), protected: true, code: code || null };
  return next();
}
