// Rechten per bedrijf: wie ziet en beheert wat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createDb, ctx } from './d1.mjs';
import * as companiesApi from '../functions/api/admin/companies.js';
import * as locationsApi from '../functions/api/admin/locations.js';
import * as productsApi from '../functions/api/admin/products.js';
import * as membersApi from '../functions/api/admin/members.js';
import * as settingsApi from '../functions/api/admin/settings.js';
import * as catalogApi from '../functions/api/catalog.js';
import * as countsApi from '../functions/api/counts.js';

const schema = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql');
const newEnv = () => ({ DB: createDb(schema) });
const asJson = async (res) => JSON.parse(await res.text());

// ADMIN_EMAILS is ingevuld: 'hoofd' staat erin, de rest niet.
const hoofd = { email: 'baas@jeconcept.be', admin: true, admin_listed: true, admin_list_set: true, protected: true };
const teller = { email: 'toog@stvv.example', admin: false, admin_listed: false, admin_list_set: true, protected: true };
const beheerder = { email: 'chef@stvv.example', admin: false, admin_listed: false, admin_list_set: true, protected: true };
const vreemde = { email: 'iemand@anders.example', admin: false, admin_listed: false, admin_list_set: true, protected: true };
// Zonder ADMIN_EMAILS is iedereen met een Access-sessie gelijk.
const zonderLijst = { email: 'wie@dan.ook', admin: true, admin_listed: false, admin_list_set: false, protected: true };

async function twoCompanies(env) {
  const a = await asJson(await companiesApi.onRequestPost(ctx(env, { method: 'POST', body: { name: 'STVV' }, user: hoofd })));
  const b = await asJson(await companiesApi.onRequestPost(ctx(env, { method: 'POST', body: { name: 'Bistro het Vinne' }, user: hoofd })));
  const loc = await asJson(await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: a.id, name: 'Toog 1' }, user: hoofd })));
  return { a: a.id, b: b.id, loc: loc.id };
}

test('niets ingesteld: iedereen met toegang mag alles', async () => {
  const env = newEnv();
  const ids = await twoCompanies(env);
  const cat = await asJson(await catalogApi.onRequestGet(ctx(env, { url: 'https://x/api/catalog', user: zonderLijst })));
  assert.equal(cat.companies.length, 2);
  assert.equal(cat.user.super_admin, true);
  assert.equal(cat.user.manageable, 'all');
  const gemaakt = await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.b, name: 'Bar' }, user: zonderLijst }));
  assert.equal(gemaakt.status, 201);
});

test('met ADMIN_EMAILS maar zonder leden ziet een vreemde niets', async () => {
  const env = newEnv();
  await twoCompanies(env);
  const cat = await asJson(await catalogApi.onRequestGet(ctx(env, { url: 'https://x/api/catalog', user: vreemde })));
  assert.deepEqual(cat.companies, []);
  assert.equal(cat.user.super_admin, false);
});

test('vanaf het eerste lid telt de lijst', async () => {
  const env = newEnv();
  const ids = await twoCompanies(env);
  await membersApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.a, email: teller.email, role: 'teller' }, user: hoofd }));
  await membersApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.a, email: beheerder.email, role: 'beheerder' }, user: hoofd }));

  // teller: ziet enkel STVV, mag niet beheren
  const catT = await asJson(await catalogApi.onRequestGet(ctx(env, { url: 'https://x/api/catalog', user: teller })));
  assert.deepEqual(catT.companies.map((c) => c.name), ['STVV']);
  assert.equal(catT.user.super_admin, false);
  assert.deepEqual(catT.user.manageable, []);
  const geweigerd = await productsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.a, name: 'Cola' }, user: teller }));
  assert.equal(geweigerd.status, 403);
  assert.match((await asJson(geweigerd)).error, /niet beheren/);

  // teller mag wél tellen
  await productsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.a, name: 'Cola', pack_size: 24, base: { [ids.loc]: 48 } }, user: hoofd }));
  const telling = await countsApi.onRequestPost(ctx(env, { method: 'POST', body: { location_id: ids.loc, lines: [] }, user: teller }));
  assert.equal(telling.status, 201);

  // beheerder van STVV mag de catalogus aanpassen, maar niet bij het bistro
  const mag = await productsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.a, name: 'Fanta' }, user: beheerder }));
  assert.equal(mag.status, 201);
  assert.deepEqual((await asJson(await catalogApi.onRequestGet(ctx(env, { url: 'https://x/api/catalog', user: beheerder })))).user.manageable, [ids.a]);
  const magNiet = await catalogApi.onRequestGet(ctx(env, { url: `https://x/api/catalog?company_id=${ids.b}`, user: beheerder }));
  assert.equal(magNiet.status, 403);

  // iemand zonder rij ziet niets
  const niets = await asJson(await catalogApi.onRequestGet(ctx(env, { url: 'https://x/api/catalog', user: vreemde })));
  assert.deepEqual(niets.companies, []);
  assert.deepEqual((await asJson(await countsApi.onRequestGet(ctx(env, { url: 'https://x/api/counts', user: vreemde })))).counts, []);

  // de hoofdbeheerder blijft overal aan mogen
  const alles = await asJson(await catalogApi.onRequestGet(ctx(env, { url: 'https://x/api/catalog', user: hoofd })));
  assert.equal(alles.companies.length, 2);
});

test('bedrijven en instellingen blijven voor de hoofdbeheerder', async () => {
  const env = newEnv();
  const ids = await twoCompanies(env);
  await membersApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.a, email: beheerder.email, role: 'beheerder' }, user: hoofd }));

  const nieuwBedrijf = await companiesApi.onRequestPost(ctx(env, { method: 'POST', body: { name: 'Nog een zaak' }, user: beheerder }));
  assert.equal(nieuwBedrijf.status, 403);
  const instelling = await settingsApi.onRequestPost(ctx(env, { method: 'POST', body: { csv_delimiter: ',' }, user: beheerder }));
  assert.equal(instelling.status, 403);
  assert.equal((await settingsApi.onRequestPost(ctx(env, { method: 'POST', body: { csv_delimiter: ',' }, user: hoofd }))).status, 200);
});

test('leden beheren en het laatste lid weghalen', async () => {
  const env = newEnv();
  const ids = await twoCompanies(env);
  await membersApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.a, email: 'Toog@STVV.example', role: 'teller' }, user: hoofd }));
  const lijst = await asJson(await membersApi.onRequestGet(ctx(env, { url: `https://x/api/admin/members?company_id=${ids.a}`, user: hoofd })));
  assert.deepEqual(lijst.members.map((m) => [m.email, m.role]), [['toog@stvv.example', 'teller']], 'adressen worden kleingeschreven bewaard');

  const fout = await membersApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ids.a, email: 'geen adres' }, user: hoofd }));
  assert.equal(fout.status, 400);

  const weg = await asJson(await membersApi.onRequestDelete(ctx(env, {
    method: 'DELETE', url: `https://x/api/admin/members?company_id=${ids.a}&email=toog@stvv.example`, user: hoofd,
  })));
  assert.match(weg.message, /laatste lid/);
  // zonder leden valt de tool terug op ADMIN_EMAILS: een vreemde ziet nog altijd niets,
  const cat = await asJson(await catalogApi.onRequestGet(ctx(env, { url: 'https://x/api/catalog', user: vreemde })));
  assert.deepEqual(cat.companies, []);
  // maar staat ook die lijst leeg, dan is alles weer open.
  const open = await asJson(await catalogApi.onRequestGet(ctx(env, { url: 'https://x/api/catalog', user: zonderLijst })));
  assert.equal(open.companies.length, 2);
});


test('het eerste lid sluit de instellende persoon niet buiten', async () => {
  const env = newEnv();
  const ids = await twoCompanies(env);
  const chef = { email: 'chef@stvv.example', admin: true, admin_listed: false, admin_list_set: false, protected: true };

  // zonder ADMIN_EMAILS: wie de lijst start, wordt er zelf als beheerder bij gezet
  const res = await asJson(await membersApi.onRequestPost(ctx(env, {
    method: 'POST', body: { company_id: ids.a, email: 'toog@stvv.example', role: 'teller' }, user: chef,
  })));
  assert.match(res.message, /zelf als beheerder toegevoegd/);
  const cat = await asJson(await catalogApi.onRequestGet(ctx(env, { url: 'https://x/api/catalog', user: chef })));
  assert.deepEqual(cat.companies.map((c) => c.name), ['STVV']);
  assert.equal(cat.user.super_admin, true, 'beheerder blijft bedrijven kunnen aanmaken zolang ADMIN_EMAILS leeg is');
  assert.deepEqual(cat.user.manageable, [ids.a], 'maar hij beheert enkel zijn eigen bedrijf');

  // zonder aangemeld adres kan het niet
  const env2 = newEnv();
  const ids2 = await twoCompanies(env2);
  const anoniem = { email: '', admin: true, admin_listed: false, admin_list_set: false, protected: true };
  const fout = await membersApi.onRequestPost(ctx(env2, {
    method: 'POST', body: { company_id: ids2.a, email: 'iemand@stvv.example', role: 'teller' }, user: anoniem,
  }));
  assert.equal(fout.status, 400);
  assert.match((await asJson(fout)).error, /ADMIN_EMAILS/);
});
