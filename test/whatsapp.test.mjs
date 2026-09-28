// De bestelling als WhatsApp-bericht: nummers, berichtopbouw, schakelaars en het logboek.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createDb, ctx } from './d1.mjs';
import * as companiesApi from '../functions/api/admin/companies.js';
import * as locationsApi from '../functions/api/admin/locations.js';
import * as suppliersApi from '../functions/api/admin/suppliers.js';
import * as productsApi from '../functions/api/admin/products.js';
import * as countsApi from '../functions/api/counts.js';
import * as waApi from '../functions/api/whatsapp.js';
import * as waAdminApi from '../functions/api/admin/whatsapp.js';
import { nummer, nummerNet, vulIn, regelTekst, eenLijn, waLink, TEMPLATE_STANDAARD } from '../functions/_lib/whatsapp.js';

const schema = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql');
const newEnv = (extra = {}) => ({ DB: createDb(schema), ...extra });
const asJson = async (res) => JSON.parse(await res.text());

async function opzet(env, { whatsapp = '0479 21 64 33', aan = true } = {}) {
  const co = await asJson(await companiesApi.onRequestPost(ctx(env, { method: 'POST', body: { name: 'STVV' } })));
  const loc = await asJson(await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: co.id, name: 'Toog 1' } })));
  const sup = await asJson(await suppliersApi.onRequestPost(ctx(env, {
    method: 'POST', body: { company_id: co.id, name: 'Gelade', whatsapp, whatsapp_active: aan },
  })));
  const cola = await asJson(await productsApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { company_id: co.id, name: 'Cola 24x25cl', unit: 'fles', pack_size: 24, pack_label: 'bak van 24',
            supplier_id: sup.id, base: { [loc.id]: 48 } },
  })));
  const vat = await asJson(await productsApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { company_id: co.id, name: 'Jupiler 50l', unit: 'vat', pack_size: 1, supplier_id: sup.id, base: { [loc.id]: 3 } },
  })));
  return { co: co.id, loc: loc.id, sup: sup.id, cola: cola.id, vat: vat.id };
}

/** Een telling waarbij alles op nul staat: alles moet besteld worden. */
const tellingLeeg = async (env, ids) => asJson(await countsApi.onRequestPost(ctx(env, {
  method: 'POST',
  body: { location_id: ids.loc, lines: [{ product_id: ids.cola, packs: 0, loose: 0 }, { product_id: ids.vat, packs: 0 }] },
})));

test('telefoonnummers worden omgezet naar de vorm die WhatsApp verwacht', () => {
  assert.equal(nummer('0479 21 64 33'), '32479216433');
  assert.equal(nummer('+32 479 21 64 33'), '32479216433');
  assert.equal(nummer('0032479216433'), '32479216433');
  assert.equal(nummer('0479/21.64.33'), '32479216433');
  assert.equal(nummer('32479216433'), '32479216433');
  assert.equal(nummerNet('0479216433'), '+32 479 21 64 33');
  assert.equal(nummer('0479'), null, 'te kort');
  assert.equal(nummer('geen nummer'), null);
  assert.equal(nummer(''), null);
  assert.match(waLink('0479 21 64 33', 'dag Rik'), /^https:\/\/wa\.me\/32479216433\?text=dag%20Rik$/);
});

test('een bestelregel leest zoals je ze aan de telefoon zou zeggen', () => {
  assert.equal(
    regelTekst({ product_name: 'Cola', unit: 'fles', pack_size: 24, pack_label: 'bak van 24', order_packs: 2, order_qty: 48 }),
    '2 × bak van 24 — Cola (48 fles)');
  assert.equal(
    regelTekst({ product_name: 'Jupiler 50l', unit: 'vat', pack_size: 1, order_packs: 3, order_qty: 3 }),
    '3 vat — Jupiler 50l');
});

test('plaatshouders worden ingevuld, onbekende blijven staan', () => {
  const tekst = vulIn('{bedrijf} / {leverancier} / {locatie} / {datum} / {aantal} / {totaal}\n{regels}\n{onbekend}', {
    company_name: 'STVV', supplier_name: 'Gelade', location_name: 'Toog 1', counted_on: '2026-09-28',
    lines: [{ product_name: 'Cola', unit: 'fles', pack_size: 24, pack_label: 'bak van 24', order_packs: 2, order_qty: 48 }],
  });
  assert.match(tekst, /^STVV \/ Gelade \/ Toog 1 \/ 28\/09\/2026 \/ 1 \/ 48$/m);
  assert.match(tekst, /• 2 × bak van 24 — Cola \(48 fles\)/);
  assert.match(tekst, /\{onbekend\}/, 'een typfout in een plaatshouder valt op');
});

test('een templateparameter mag geen regeleindes bevatten', () => {
  assert.equal(eenLijn('• a\n• b\n\n• c'), '• a · • b · • c');
});

test('het voorstel per leverancier bevat het bericht en de link', async () => {
  const env = newEnv();
  const ids = await opzet(env);
  const { id } = await tellingLeeg(env, ids);

  const plan = await asJson(await waApi.onRequestGet(ctx(env, { url: `https://x/api/whatsapp?count_id=${id}` })));
  assert.equal(plan.configured, false, 'zonder token kan er niet automatisch verstuurd worden');
  assert.equal(plan.location_active, true);
  assert.equal(plan.messages.length, 1);

  const bericht = plan.messages[0];
  assert.equal(bericht.supplier_name, 'Gelade');
  assert.equal(bericht.to_number, '32479216433');
  assert.equal(bericht.to_display, '+32 479 21 64 33');
  assert.equal(bericht.skip, null);
  assert.equal(bericht.lines, 2);
  assert.equal(bericht.units, 51, '48 fles cola + 3 vaten');
  assert.match(bericht.body, /Dag Gelade/);
  assert.match(bericht.body, /STVV — Toog 1/);
  assert.match(bericht.body, /• 2 × bak van 24 — Cola 24x25cl \(48 fles\)/);
  assert.match(bericht.body, /• 3 vat — Jupiler 50l/);
  assert.ok(bericht.link.startsWith('https://wa.me/32479216433?text='));
});

test('uitgezet per leverancier, per locatie of zonder nummer: overslaan met de reden erbij', async () => {
  const env = newEnv();
  const ids = await opzet(env, { aan: false });
  const { id } = await tellingLeeg(env, ids);

  let plan = await asJson(await waApi.onRequestGet(ctx(env, { url: `https://x/api/whatsapp?count_id=${id}` })));
  assert.match(plan.messages[0].skip, /staat uit voor deze leverancier/);

  // schakelaar aan
  await suppliersApi.onRequestPut(ctx(env, {
    method: 'PUT', body: { id: ids.sup, name: 'Gelade', whatsapp: '0479 21 64 33', whatsapp_active: true },
  }));
  plan = await asJson(await waApi.onRequestGet(ctx(env, { url: `https://x/api/whatsapp?count_id=${id}` })));
  assert.equal(plan.messages[0].skip, null);

  // locatie uit
  await locationsApi.onRequestPut(ctx(env, {
    method: 'PUT', body: { id: ids.loc, name: 'Toog 1', whatsapp_active: false },
  }));
  plan = await asJson(await waApi.onRequestGet(ctx(env, { url: `https://x/api/whatsapp?count_id=${id}` })));
  assert.equal(plan.location_active, false);
  assert.match(plan.messages[0].skip, /staat uit voor Toog 1/);

  // locatie terug aan, nummer weg
  await locationsApi.onRequestPut(ctx(env, { method: 'PUT', body: { id: ids.loc, name: 'Toog 1', whatsapp_active: true } }));
  await suppliersApi.onRequestPut(ctx(env, { method: 'PUT', body: { id: ids.sup, name: 'Gelade', whatsapp: '', whatsapp_active: true } }));
  plan = await asJson(await waApi.onRequestGet(ctx(env, { url: `https://x/api/whatsapp?count_id=${id}` })));
  assert.match(plan.messages[0].skip, /geen WhatsApp-nummer/);
});

test('een onmogelijk nummer wordt geweigerd, niet stil bewaard', async () => {
  const env = newEnv();
  const ids = await opzet(env);
  const res = await suppliersApi.onRequestPut(ctx(env, {
    method: 'PUT', body: { id: ids.sup, name: 'Gelade', whatsapp: '12' },
  }));
  assert.equal(res.status, 400);
  assert.match((await asJson(res)).error, /geen geldig telefoonnummer/);
});

test('versturen gaat naar de Cloud API en komt in het logboek', async () => {
  const gestuurd = [];
  const env = newEnv({ WHATSAPP_TOKEN: 'geheim', WHATSAPP_PHONE_ID: '123' });
  globalThis.fetch = async (url, opties) => {
    gestuurd.push({ url, body: JSON.parse(opties.body) });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.TEST' }] }) };
  };
  const ids = await opzet(env);
  const { id } = await tellingLeeg(env, ids);

  const plan = await asJson(await waApi.onRequestGet(ctx(env, { url: `https://x/api/whatsapp?count_id=${id}` })));
  assert.equal(plan.configured, true);

  const uit = await asJson(await waApi.onRequestPost(ctx(env, {
    method: 'POST', body: { count_id: id, suppliers: [{ supplier_id: ids.sup }] },
    user: { email: 'jasper@kenjeklanten.be', protected: true, code: null },
  })));
  assert.equal(uit.verzonden, 1);
  assert.equal(uit.results[0].ok, true);

  assert.equal(gestuurd.length, 1);
  assert.match(gestuurd[0].url, /graph\.facebook\.com\/v\d+\.\d+\/123\/messages$/);
  assert.equal(gestuurd[0].body.to, '32479216433');
  assert.equal(gestuurd[0].body.type, 'text');
  assert.match(gestuurd[0].body.text.body, /Cola 24x25cl/);

  const beheer = await asJson(await waAdminApi.onRequestGet(ctx(env, { url: `https://x/api/admin/whatsapp?company_id=${ids.co}` })));
  assert.equal(beheer.log.length, 1);
  assert.equal(beheer.log[0].status, 'verzonden');
  assert.equal(beheer.log[0].detail, 'wamid.TEST');
  assert.equal(beheer.log[0].supplier_name, 'Gelade');
  assert.equal(beheer.log[0].sent_by, 'jasper@kenjeklanten.be');

  // de telling staat nu op besteld, zonder tweede klik
  const na = await asJson(await waApi.onRequestGet(ctx(env, { url: `https://x/api/whatsapp?count_id=${id}` })));
  assert.equal(na.count.status, 'besteld');
});

test('buiten het venster van 24 uur legt WhatsApp een vrij bericht stil; dat wordt uitgelegd', async () => {
  const env = newEnv({ WHATSAPP_TOKEN: 'geheim', WHATSAPP_PHONE_ID: '123' });
  globalThis.fetch = async () => ({
    ok: false, status: 400,
    json: async () => ({ error: { code: 131047, message: 'Re-engagement message' } }),
  });
  const ids = await opzet(env);
  const { id } = await tellingLeeg(env, ids);
  const uit = await asJson(await waApi.onRequestPost(ctx(env, {
    method: 'POST', body: { count_id: id, suppliers: [{ supplier_id: ids.sup }] },
  })));
  assert.equal(uit.verzonden, 0);
  assert.equal(uit.results[0].venster, true);
  assert.match(uit.results[0].fout, /binnen 24 uur/);

  const beheer = await asJson(await waAdminApi.onRequestGet(ctx(env, { url: `https://x/api/admin/whatsapp?company_id=${ids.co}` })));
  assert.equal(beheer.log[0].status, 'mislukt', 'een mislukte poging blijft ook in het logboek staan');

  // een mislukte poging zet de bestelling niet op besteld
  const na = await asJson(await waApi.onRequestGet(ctx(env, { url: `https://x/api/whatsapp?count_id=${id}` })));
  assert.equal(na.count.status, 'open');
});

test('met een goedgekeurde template gaat het bericht als template mee, op één lijn', async () => {
  const gestuurd = [];
  const env = newEnv({ WHATSAPP_TOKEN: 'geheim', WHATSAPP_PHONE_ID: '123', WHATSAPP_TEMPLATE: 'bestelling', WHATSAPP_TAAL: 'nl' });
  globalThis.fetch = async (url, opties) => {
    gestuurd.push(JSON.parse(opties.body));
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.T' }] }) };
  };
  const ids = await opzet(env);
  const { id } = await tellingLeeg(env, ids);
  const plan = await asJson(await waApi.onRequestGet(ctx(env, { url: `https://x/api/whatsapp?count_id=${id}` })));
  assert.equal(plan.template_mode, true);

  await waApi.onRequestPost(ctx(env, { method: 'POST', body: { count_id: id, suppliers: [{ supplier_id: ids.sup }] } }));
  assert.equal(gestuurd[0].type, 'template');
  assert.equal(gestuurd[0].template.name, 'bestelling');
  assert.equal(gestuurd[0].template.language.code, 'nl');
  const param = gestuurd[0].template.components[0].parameters[0].text;
  assert.ok(!param.includes('\n'), 'een templateparameter mag geen regeleindes bevatten');
  assert.match(param, /Cola 24x25cl/);
});

test('handmatig doorgegeven via de link komt ook in het logboek, zonder de API', async () => {
  const env = newEnv();
  globalThis.fetch = async () => { throw new Error('er mag niets verstuurd worden'); };
  const ids = await opzet(env);
  const { id } = await tellingLeeg(env, ids);
  const uit = await asJson(await waApi.onRequestPost(ctx(env, {
    method: 'POST', body: { count_id: id, suppliers: [{ supplier_id: ids.sup }], handmatig: true },
    user: { email: '', protected: false, code: { label: 'Tellen STVV', role: 'teller', company_id: null } },
  })));
  assert.equal(uit.verzonden, 1);
  const beheer = await asJson(await waAdminApi.onRequestGet(ctx(env, { url: `https://x/api/admin/whatsapp?company_id=${ids.co}` })));
  assert.equal(beheer.log[0].status, 'handmatig');
  assert.equal(beheer.log[0].sent_by, 'Tellen STVV', 'aan de toog is het label van de code de naam');
});

test('een aangepast bericht van het scherm gaat voor op het opgestelde', async () => {
  const gestuurd = [];
  const env = newEnv({ WHATSAPP_TOKEN: 'geheim', WHATSAPP_PHONE_ID: '123' });
  globalThis.fetch = async (url, opties) => {
    gestuurd.push(JSON.parse(opties.body));
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.X' }] }) };
  };
  const ids = await opzet(env);
  const { id } = await tellingLeeg(env, ids);
  await waApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { count_id: id, suppliers: [{ supplier_id: ids.sup, body: 'Rik, doe maar 2 bakken cola. Groeten!' }] },
  }));
  assert.equal(gestuurd[0].text.body, 'Rik, doe maar 2 bakken cola. Groeten!');
});

test('het bericht van het bedrijf en dat van een leverancier', async () => {
  const env = newEnv();
  const ids = await opzet(env);
  const { id } = await tellingLeeg(env, ids);

  // leeg = het standaardbericht
  let beheer = await asJson(await waAdminApi.onRequestGet(ctx(env, { url: `https://x/api/admin/whatsapp?company_id=${ids.co}` })));
  assert.equal(beheer.template, '');
  assert.equal(beheer.standaard, TEMPLATE_STANDAARD);

  // een bericht zonder {regels} zou de bestelling weglaten
  const zonder = await waAdminApi.onRequestPut(ctx(env, {
    method: 'PUT', body: { company_id: ids.co, template: 'Hallo, graag een levering.' },
  }));
  assert.equal(zonder.status, 400);
  assert.match((await asJson(zonder)).error, /\{regels\}/);

  await waAdminApi.onRequestPut(ctx(env, {
    method: 'PUT', body: { company_id: ids.co, template: 'Hey {leverancier}!\n{regels}\nTot morgen.' },
  }));
  let plan = await asJson(await waApi.onRequestGet(ctx(env, { url: `https://x/api/whatsapp?count_id=${id}` })));
  assert.match(plan.messages[0].body, /^Hey Gelade!/);
  assert.match(plan.messages[0].body, /Tot morgen\.$/);
  assert.equal(plan.messages[0].eigen_bericht, false);

  // het bericht van de leverancier zelf gaat voor
  await suppliersApi.onRequestPut(ctx(env, {
    method: 'PUT',
    body: { id: ids.sup, name: 'Gelade', whatsapp: '0479216433', whatsapp_active: true,
            whatsapp_template: 'Rik, {regels} — bedankt!' },
  }));
  plan = await asJson(await waApi.onRequestGet(ctx(env, { url: `https://x/api/whatsapp?count_id=${id}` })));
  assert.match(plan.messages[0].body, /^Rik, /);
  assert.equal(plan.messages[0].eigen_bericht, true);
});

test('producten zonder leverancier worden overgeslagen, niet naar een verkeerd nummer gestuurd', async () => {
  const env = newEnv();
  const ids = await opzet(env);
  const los = await asJson(await productsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { company_id: ids.co, name: 'Tandenstokers', unit: 'pak', pack_size: 1, base: { [ids.loc]: 3 } },
  })));
  const { id } = await asJson(await countsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { location_id: ids.loc, lines: [{ product_id: los.id, packs: 0 }] },
  })));
  const plan = await asJson(await waApi.onRequestGet(ctx(env, { url: `https://x/api/whatsapp?count_id=${id}` })));
  assert.equal(plan.messages.length, 1);
  assert.equal(plan.messages[0].supplier_name, 'Zonder leverancier');
  assert.match(plan.messages[0].skip, /geen leverancier/);

  const uit = await asJson(await waApi.onRequestPost(ctx(env, {
    method: 'POST', body: { count_id: id, suppliers: [{ supplier_id: null }] },
  })));
  assert.equal(uit.verzonden, 0);
});

test('een code voor een ander bedrijf kan geen bericht versturen', async () => {
  const env = newEnv();
  const ids = await opzet(env);
  const { id } = await tellingLeeg(env, ids);
  const ander = { email: '', protected: false, code: { label: 'Tellen Vinne', role: 'teller', company_id: 999 } };
  assert.equal((await waApi.onRequestGet(ctx(env, { url: `https://x/api/whatsapp?count_id=${id}`, user: ander }))).status, 403);
  assert.equal((await waApi.onRequestPost(ctx(env, {
    method: 'POST', user: ander, body: { count_id: id, suppliers: [{ supplier_id: ids.sup }] },
  }))).status, 403);
});
