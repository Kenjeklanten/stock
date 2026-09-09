// Controleert de Cloudflare Access-bewaking in functions/_middleware.js met een zelf ondertekende JWT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';

const TEAM = 'jeconcept.cloudflareaccess.com';
const AUD = 'aud-tag-123';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
const certs = { keys: [{ kid: 'test-kid', kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256' }] };

async function makeToken(payload, { kid = 'test-kid', tamper = false } = {}) {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid }));
  const body = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  const token = `${head}.${body}.${b64url(sig)}`;
  if (!tamper) return token;
  const other = b64url(JSON.stringify({ ...payload, email: 'inbreker@example.com' }));
  return `${head}.${other}.${b64url(sig)}`;
}

const now = () => Math.floor(Date.now() / 1000);
const claims = (extra = {}) => ({ email: 'jasper@kenjeklanten.be', aud: [AUD], iss: `https://${TEAM}`, exp: now() + 3600, iat: now(), ...extra });

function context(token, env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }) {
  const data = {};
  const request = new Request('https://bestel.jeconcept.be/api/catalog', {
    headers: token ? { 'cf-access-jwt-assertion': token } : undefined,
  });
  return { request, env, data, next: async () => new Response('ok'), _data: data };
}

const withCerts = async (fn) => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).includes('/cdn-cgi/access/certs')
    ? new Response(JSON.stringify(certs), { headers: { 'content-type': 'application/json' } })
    : original(url));
  try { return await fn(); } finally { globalThis.fetch = original; }
};

test('geldige Access-sessie mag door en levert het e-mailadres', async () => {
  await withCerts(async () => {
    const ctx = context(await makeToken(claims()));
    const res = await onRequest(ctx);
    assert.equal(res.status, 200);
    assert.equal(ctx.data.user.email, 'jasper@kenjeklanten.be');
    assert.equal(ctx.data.user.protected, true);
    assert.equal(ctx.data.user.admin, true, 'zonder ADMIN_EMAILS mag iedereen met toegang beheren');
  });
});

test('ADMIN_EMAILS bepaalt wie mag beheren', async () => {
  await withCerts(async () => {
    const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: 'baas@jeconcept.be, jasper@kenjeklanten.be' };
    const admin = context(await makeToken(claims()), env);
    await onRequest(admin);
    assert.equal(admin.data.user.admin, true);

    const staff = context(await makeToken(claims({ email: 'student@jeconcept.be' })), env);
    await onRequest(staff);
    assert.equal(staff.data.user.admin, false);
  });
});

test('geen, vervallen, vervalste of vreemde tokens worden geweigerd', async () => {
  await withCerts(async () => {
    const cases = {
      'geen token': null,
      'vervallen': await makeToken(claims({ exp: now() - 120 })),
      'verkeerde aud': await makeToken(claims({ aud: ['een-andere-applicatie'] })),
      'verkeerde uitgever': await makeToken(claims({ iss: 'https://kwaadaardig.example' })),
      'onbekende sleutel': await makeToken(claims(), { kid: 'niet-van-ons' }),
      'vervalste inhoud': await makeToken(claims(), { tamper: true }),
      'geen jwt': 'zomaar-wat-tekst',
    };
    for (const [naam, token] of Object.entries(cases)) {
      const res = await onRequest(context(token));
      assert.equal(res.status, 403, `${naam} zou geweigerd moeten worden`);
      assert.match(await res.text(), /Access/);
    }
  });
});

test('zonder ACCESS_TEAM_DOMAIN draait de tool open (lokaal ontwikkelen)', async () => {
  const ctx = context(null, {});
  const res = await onRequest(ctx);
  assert.equal(res.status, 200);
  assert.equal(ctx.data.user.protected, false);
  assert.equal(ctx.data.user.admin, true);
});
