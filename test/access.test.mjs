// Rechten: alles hangt aan de toegangscode waarmee de browser binnen is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createDb, ctx } from './d1.mjs';
import * as companiesApi from '../functions/api/admin/companies.js';
import * as locationsApi from '../functions/api/admin/locations.js';
import * as productsApi from '../functions/api/admin/products.js';
import * as codesApi from '../functions/api/admin/codes.js';
import * as catalogApi from '../functions/api/catalog.js';
import * as countsApi from '../functions/api/counts.js';

const schema = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql');
const newEnv = () => ({ DB: createDb(schema) });
const asJson = async (res) => JSON.parse(await res.text());

/** Een browser die met een bepaalde code binnen is; `null` = er is geen code ingesteld. */
const met = (code) => ({ email: '', protected: false, code });
const geenCode = met(null);
const volledig = met({ label: 'Volledige toegang', role: 'beheerder', company_id: null });
const allesTellen = met({ label: 'Tellen overal', role: 'teller', company_id: null });

async function tweeBedrijven(env) {
  const a = await asJson(await companiesApi.onRequestPost(ctx(env, { method: 'POST', body: { name: 'STVV' }, user: geenCode })));
  const b = await asJson(await companiesApi.onRequestPost(ctx(env, { method: 'POST', body: { name: 'Bistro het Vinne' }, user: geenCode })));
  const loc = await asJson(await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: a.id, name: 'Toog 1' }, user: geenCode })));
  return { a: a.id, b: b.id, loc: loc.id };
}

test('zonder ingestelde code staat alles open', async () => {
  const env = newEnv();
  const ids = await tweeBedrijven(env);
  const cat = await asJson(await catalogApi.onRequestGet(ctx(env, { url: 'https://x/api/catalog', user: geenCode })));
  assert.equal(cat.companies.length, 2);
  assert.equal(cat.user.manageable, 'all');
  assert.equal((await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.b, name: 'Bar' }, user: geenCode }))).status, 201);
});

test('een code voor één bedrijf ziet enkel dat bedrijf', async () => {
  const env = newEnv();
  const ids = await tweeBedrijven(env);
  const stvv = met({ label: 'Tellen STVV', role: 'teller', company_id: ids.a });

  const cat = await asJson(await catalogApi.onRequestGet(ctx(env, { url: 'https://x/api/catalog', user: stvv })));
  assert.deepEqual(cat.companies.map((c) => c.name), ['STVV']);
  assert.deepEqual(cat.user.manageable, []);
  assert.equal(cat.user.code.label, 'Tellen STVV');

  assert.equal((await catalogApi.onRequestGet(ctx(env, { url: `https://x/api/catalog?company_id=${ids.b}`, user: stvv }))).status, 403);
  assert.equal((await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.a, name: 'Toog 9' }, user: stvv }))).status, 403);
  assert.equal((await companiesApi.onRequestPost(ctx(env, { method: 'POST', body: { name: 'Nog een zaak' }, user: stvv }))).status, 403);
});

test('een beheerderscode voor één bedrijf mag daar wél de catalogus aanpassen', async () => {
  const env = newEnv();
  const ids = await tweeBedrijven(env);
  const chef = met({ label: 'Beheer STVV', role: 'beheerder', company_id: ids.a });

  assert.equal((await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.a, name: 'Toog 9' }, user: chef }))).status, 201);
  assert.equal((await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.b, name: 'Bar' }, user: chef }))).status, 403);
  // bedrijven aanmaken blijft voorbehouden aan een code zonder bedrijf
  assert.equal((await companiesApi.onRequestPost(ctx(env, { method: 'POST', body: { name: 'Derde zaak' }, user: chef }))).status, 403);
});

test('een tellercode zonder bedrijf ziet alles maar beheert niets', async () => {
  const env = newEnv();
  const ids = await tweeBedrijven(env);
  const cat = await asJson(await catalogApi.onRequestGet(ctx(env, { url: 'https://x/api/catalog', user: allesTellen })));
  assert.equal(cat.companies.length, 2);
  assert.deepEqual(cat.user.manageable, []);
  assert.equal((await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.a, name: 'Toog 9' }, user: allesTellen }))).status, 403);
  assert.equal((await codesApi.onRequestGet(ctx(env, { user: allesTellen }))).status, 403);
});

test('tellen mag met elke code, ook die van één bedrijf', async () => {
  const env = newEnv();
  const ids = await tweeBedrijven(env);
  const p = await asJson(await productsApi.onRequestPost(ctx(env, {
    method: 'POST', user: volledig,
    body: { company_id: ids.a, name: 'Cola', unit: 'fles', pack_size: 24, base: { [ids.loc]: 48 } },
  })));
  const stvv = met({ label: 'Tellen STVV', role: 'teller', company_id: ids.a });
  const res = await countsApi.onRequestPost(ctx(env, {
    method: 'POST', user: stvv, body: { location_id: ids.loc, lines: [{ product_id: p.id, packs: 1 }] },
  }));
  assert.equal(res.status, 201);
});

test('codes beheren kan enkel met een code voor volledige toegang', async () => {
  const env = newEnv();
  const ids = await tweeBedrijven(env);
  assert.equal((await codesApi.onRequestGet(ctx(env, { user: volledig }))).status, 200);

  const gemaakt = await codesApi.onRequestPost(ctx(env, {
    method: 'POST', user: volledig, body: { code: '4321', label: 'Tellen Vinne', role: 'teller', company_id: ids.b },
  }));
  assert.equal(gemaakt.status, 201);

  const chef = met({ label: 'Beheer STVV', role: 'beheerder', company_id: ids.a });
  assert.equal((await codesApi.onRequestGet(ctx(env, { user: chef }))).status, 403);
});
