// End-to-end test van de besteltool-API op een SQLite-database in het geheugen.
//   node --test bestel/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createDb, ctx } from './d1.mjs';
import { orderQty, shortage, orderPacks, fmt, countedTotal, splitCount } from '../functions/_lib/order.js';
import { parseCsv, toCsv, slug } from '../functions/_lib/csv.js';

import * as companiesApi from '../functions/api/admin/companies.js';
import * as locationsApi from '../functions/api/admin/locations.js';
import * as suppliersApi from '../functions/api/admin/suppliers.js';
import * as productsApi from '../functions/api/admin/products.js';
import * as catalogApi from '../functions/api/catalog.js';
import * as countsApi from '../functions/api/counts.js';
import * as countApi from '../functions/api/counts/[id].js';
import * as csvApi from '../functions/api/counts/[id]/csv.js';
import * as pdfApi from '../functions/api/counts/[id]/pdf.js';
import * as xlsxApi from '../functions/api/export/xlsx.js';
import * as receiptApi from '../functions/api/counts/[id]/receipt.js';
import * as codesApi from '../functions/api/admin/codes.js';
import * as dashboardApi from '../functions/api/dashboard.js';
import * as salesApi from '../functions/api/sales.js';
import * as salesReportApi from '../functions/api/sales/[id].js';
import * as salesMapApi from '../functions/api/admin/sales-mapping.js';
import { inhoud, stelProductVoor, stelLocatieVoor } from '../functions/_lib/sales.js';
import * as stockApi from '../functions/api/stock.js';
import * as movesApi from '../functions/api/moves.js';
import * as reasonsApi from '../functions/api/admin/reasons.js';
import { bestellijstNaam } from '../functions/_lib/bestellijst.js';

const schema = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql');
const newEnv = () => ({ DB: createDb(schema) });
const asJson = async (res) => JSON.parse(await res.text());

async function seed(env, { name = 'STVV' } = {}) {
  const company = await asJson(await companiesApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { name },
  })));
  const co = company.id;
  const loc = await asJson(await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: co, name: 'Bar tribune 1' } })));
  const loc2 = await asJson(await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: co, name: 'Magazijn' } })));
  const sup = await asJson(await suppliersApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: co, name: 'Drankencentrale' } })));
  const cola = await asJson(await productsApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { company_id: co, name: 'Cola 33cl', unit: 'blik', pack_size: 24, pack_label: 'bak van 24', supplier_id: sup.id, base: { [loc.id]: 48, [loc2.id]: 24 } },
  })));
  const chips = await asJson(await productsApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { company_id: co, name: 'Chips paprika', unit: 'zak', pack_size: 1, supplier_id: sup.id, base: { [loc.id]: 20 } },
  })));
  const servet = await asJson(await productsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { company_id: co, name: 'Servetten', unit: 'pak', pack_size: 1, base: { [loc.id]: 10 } },
  })));
  return { co, loc: loc.id, loc2: loc2.id, sup: sup.id, cola: cola.id, chips: chips.id, servet: servet.id };
}

test('rekenregel: tekort afgerond op een volle verpakking', () => {
  assert.equal(orderQty(48, 30, 24), 24, '18 tekort → 1 bak van 24');
  assert.equal(orderQty(48, 0, 24), 48, 'niets in huis → 2 bakken');
  assert.equal(orderQty(48, 48, 24), 0, 'op basisstock → niets bestellen');
  assert.equal(orderQty(48, 60, 24), 0, 'meer dan basis → niets bestellen');
  assert.equal(orderQty(20, 12.5, 1), 8, 'bij een verpakking van 1 bestel je hele eenheden');
  assert.equal(orderQty(20, 12.5, 0.5), 7.5, 'een halve verpakking laat halve eenheden toe');
  assert.equal(orderQty(10, null, 1), 0, 'niet geteld → niet bestellen');
  assert.equal(orderQty(48, 24, 0), 24, 'verpakking 0 telt als 1');
  assert.equal(shortage(48, 30), 18);
  assert.equal(orderPacks(48, 24), 2);
  assert.equal(fmt(1.5), '1,5');
  assert.equal(fmt(12), '12');
});

test('catalogus per locatie toont enkel producten met een basisstock', async () => {
  const env = newEnv();
  const ids = await seed(env);
  const one = await asJson(await catalogApi.onRequestGet(ctx(env, { url: `https://x/api/catalog?company_id=${ids.co}&location_id=${ids.loc}` })));
  assert.equal(one.products.length, 3);
  const two = await asJson(await catalogApi.onRequestGet(ctx(env, { url: `https://x/api/catalog?company_id=${ids.co}&location_id=${ids.loc2}` })));
  assert.deepEqual(two.products.map((p) => p.name), ['Cola 33cl']);
  assert.equal(two.products[0].base_qty, 24);
});

test('telling opslaan berekent de bestelling en groepeert per leverancier', async () => {
  const env = newEnv();
  const ids = await seed(env);
  const created = await asJson(await countsApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: {
      location_id: ids.loc, counted_on: '2026-09-09', note: 'weekendtelling',
      lines: [
        { product_id: ids.cola, counted_qty: 30 },   // basis 48, bak 24 → 24
        { product_id: ids.chips, counted_qty: 25 },  // basis 20 → niets
        { product_id: ids.servet, counted_qty: null }, // niet geteld
      ],
    },
  })));
  assert.ok(created.id);

  const detail = await asJson(await countApi.onRequestGet(ctx(env, { params: { id: String(created.id) } })));
  assert.equal(detail.count.location_name, 'Bar tribune 1');
  assert.equal(detail.count.company_name, 'STVV');
  assert.equal(detail.count.created_by, 'test@jeconcept.be');
  assert.equal(detail.lines.length, 3, 'elke product-regel wordt bewaard, ook niet-getelde');
  assert.equal(detail.orders.length, 1, 'één leverancier met een bestelling');
  assert.equal(detail.orders[0].supplier_name, 'Drankencentrale');
  assert.deepEqual(detail.orders[0].lines.map((l) => [l.product_name, l.order_qty]), [['Cola 33cl', 24]]);

  const list = await asJson(await countsApi.onRequestGet(ctx(env, { url: 'https://x/api/counts' })));
  assert.equal(list.counts[0].counted_lines, 2);
  assert.equal(list.counts[0].order_lines, 1);
});

test('telling aanpassen herberekent, status kan aan en uit', async () => {
  const env = newEnv();
  const ids = await seed(env);
  const { id } = await asJson(await countsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { location_id: ids.loc, lines: [{ product_id: ids.cola, counted_qty: 48 }] },
  })));

  let detail = await asJson(await countApi.onRequestPut(ctx(env, {
    method: 'PUT', params: { id: String(id) },
    body: { note: 'aangepast', lines: [{ product_id: ids.cola, counted_qty: 0 }, { product_id: ids.servet, counted_qty: 4 }] },
  })));
  const cola = detail.lines.find((l) => l.product_name === 'Cola 33cl');
  assert.equal(cola.order_qty, 48);
  assert.equal(detail.count.note, 'aangepast');
  assert.equal(detail.lines.find((l) => l.product_name === 'Servetten').order_qty, 6);

  await countApi.onRequestPatch(ctx(env, { method: 'PATCH', params: { id: String(id) }, body: { status: 'besteld' } }));
  detail = await asJson(await countApi.onRequestGet(ctx(env, { params: { id: String(id) } })));
  assert.equal(detail.count.status, 'besteld');
  assert.ok(detail.count.ordered_at);

  const blocked = await countApi.onRequestPut(ctx(env, { method: 'PUT', params: { id: String(id) }, body: { lines: [] } }));
  assert.equal(blocked.status, 409, 'een bestelde telling wordt niet zomaar overschreven');

  await countApi.onRequestPatch(ctx(env, { method: 'PATCH', params: { id: String(id) }, body: { status: 'open' } }));
  detail = await asJson(await countApi.onRequestGet(ctx(env, { params: { id: String(id) } })));
  assert.equal(detail.count.status, 'open');
  assert.equal(detail.count.ordered_at, null);
});

test('CSV-export van de bestelling', async () => {
  const env = newEnv();
  const ids = await seed(env);
  const { id } = await asJson(await countsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { location_id: ids.loc, counted_on: '2026-09-09', lines: [{ product_id: ids.cola, counted_qty: 30 }, { product_id: ids.chips, counted_qty: 25 }] },
  })));

  const res = await csvApi.onRequestGet(ctx(env, { params: { id: String(id) }, url: 'https://x/api/counts/1/csv' }));
  const body = await res.text();
  assert.match(res.headers.get('content-disposition'), /bestelling-stvv-bar-tribune-1-2026-09-09\.csv/);
  const rows = parseCsv(body);
  assert.equal(rows.length, 2, 'kop + enkel de te bestellen regel');
  assert.deepEqual(rows[1].slice(0, 2), ['Drankencentrale', 'Cola 33cl']);
  assert.equal(rows[0][9], 'Te bestellen');
  assert.equal(rows[1][9], '24', 'kolom "Te bestellen"');
  const bytes = new Uint8Array(await (await csvApi.onRequestGet(ctx(env, { params: { id: String(id) }, url: 'https://x/api/counts/1/csv' }))).arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM zodat Excel de accenten juist leest');

  const full = await (await csvApi.onRequestGet(ctx(env, { params: { id: String(id) }, url: 'https://x/api/counts/1/csv?scope=all' }))).text();
  assert.equal(parseCsv(full).length, 4, 'volledig telblad = kop + 3 producten');
});

test('bestelbon-PDF is een geldig PDF-bestand', async () => {
  const env = newEnv();
  const ids = await seed(env);
  const { id } = await asJson(await countsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { location_id: ids.loc, lines: [{ product_id: ids.cola, counted_qty: 0 }, { product_id: ids.servet, counted_qty: 0 }] },
  })));
  const res = await pdfApi.onRequestGet(ctx(env, { params: { id: String(id) }, url: 'https://x/api/counts/1/pdf' }));
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.endsWith('%%EOF\n'));
  assert.match(text, /Drankencentrale/);
  assert.match(text, /Bar tribune 1/);
  assert.match(text, /STVV/, 'de bedrijfsnaam staat op de bestelbon');

  // xref-tabel moet naar echte objecten wijzen
  const start = Number(text.slice(text.lastIndexOf('startxref')).split('\n')[1]);
  assert.ok(text.slice(start, start + 4) === 'xref');
  const offsets = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.ok(offsets.length >= 6);
  offsets.forEach((offset, i) => assert.match(text.slice(offset, offset + 12), new RegExp(`^${i + 1} 0 obj`)));
});

test('producten en locaties met historiek worden gearchiveerd, niet verwijderd', async () => {
  const env = newEnv();
  const ids = await seed(env);
  await countsApi.onRequestPost(ctx(env, { method: 'POST', body: { location_id: ids.loc, lines: [{ product_id: ids.cola, counted_qty: 1 }] } }));

  const removed = await asJson(await productsApi.onRequestDelete(ctx(env, { method: 'DELETE', url: `https://x/api/admin/products?id=${ids.cola}` })));
  assert.equal(removed.archived, true);
  const removedLoc = await asJson(await locationsApi.onRequestDelete(ctx(env, { method: 'DELETE', url: `https://x/api/admin/locations?id=${ids.loc}` })));
  assert.equal(removedLoc.archived, true);

  // Een product dat in geen enkele telling voorkomt, verdwijnt wel echt.
  const fresh = await asJson(await productsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { company_id: ids.co, name: 'Rietjes', unit: 'pak', pack_size: 1, base: { [ids.loc2]: 5 } },
  })));
  const unused = await asJson(await productsApi.onRequestDelete(ctx(env, { method: 'DELETE', url: `https://x/api/admin/products?id=${fresh.id}` })));
  assert.equal(unused.ok, true);
  assert.equal(unused.archived, undefined);
});

test('beheren kan niet met een code die enkel mag tellen', async () => {
  const env = newEnv();
  const ids = await seed(env);
  const teller = { email: '', protected: false, code: { label: 'Tellen', role: 'teller', company_id: ids.co } };
  const geweigerd = await locationsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { company_id: ids.co, name: 'Toog 9' }, user: teller,
  }));
  assert.equal(geweigerd.status, 403);
  assert.match((await asJson(geweigerd)).error, /enkel om te tellen/);
});

test('foutmeldingen zijn leesbaar', async () => {
  const env = newEnv();
  const noLocation = await countsApi.onRequestPost(ctx(env, { method: 'POST', body: { lines: [] } }));
  assert.equal(noLocation.status, 400);
  assert.match((await asJson(noLocation)).error, /locatie/i);

  const missing = await countApi.onRequestGet(ctx(env, { params: { id: '999' } }));
  assert.equal(missing.status, 404);

  const noDb = await catalogApi.onRequestGet({ request: new Request('https://x/api/catalog'), env: {}, params: {}, data: {} });
  assert.equal(noDb.status, 500);
  assert.match((await asJson(noDb)).error, /D1-binding/);
});

test('CSV-hulpmiddelen', () => {
  assert.deepEqual(parseCsv('a,b\n1,"tekst, met komma"'), [['a', 'b'], ['1', 'tekst, met komma']]);
  assert.deepEqual(parseCsv('a;b\r\n1;2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.equal(toCsv(['a'], [['x;y']], ';').includes('"x;y"'), true);
  assert.equal(slug('Bar Sint-Truiden — café'), 'bar-sint-truiden-cafe');
});


test('tellen gebeurt in volle pakken en losse stuks', async () => {
  assert.equal(countedTotal(2, 5, 24), 53, '2 bakken van 24 en 5 losse');
  assert.equal(countedTotal(2, null, 24), 48, 'alleen pakken');
  assert.equal(countedTotal(null, 7, 24), 7, 'alleen losse stuks');
  assert.equal(countedTotal(null, null, 24), null, 'niets ingevuld = niet geteld');
  assert.equal(countedTotal(0, 0, 24), 0, 'nul is wél geteld');
  assert.deepEqual(splitCount(53, 24), { packs: 2, loose: 5 });
  assert.deepEqual(splitCount(7, 1), { packs: 0, loose: 7 });

  const env = newEnv();
  const ids = await seed(env);
  const { id } = await asJson(await countsApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: {
      location_id: ids.loc, counted_on: '2026-09-09',
      lines: [
        { product_id: ids.cola, packs: 1, loose: 6 },   // basis 48, geteld 30 → 18 tekort → 1 bak van 24
        { product_id: ids.chips, packs: null, loose: 25 },
        { product_id: ids.servet, packs: '', loose: '' },
      ],
    },
  })));

  const detail = await asJson(await countApi.onRequestGet(ctx(env, { params: { id: String(id) } })));
  const cola = detail.lines.find((l) => l.product_name === 'Cola 33cl');
  assert.equal(cola.counted_packs, 1);
  assert.equal(cola.counted_loose, 6);
  assert.equal(cola.counted_qty, 30);
  assert.equal(cola.order_qty, 24);
  const servet = detail.lines.find((l) => l.product_name === 'Servetten');
  assert.equal(servet.counted_qty, null, 'twee lege velden = niet geteld');

  const csv = await (await csvApi.onRequestGet(ctx(env, { params: { id: String(id) }, url: 'https://x/api/counts/1/csv?scope=all' }))).text();
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0].slice(5, 8), ['Geteld volle pakken', 'Geteld losse stuks', 'Geteld totaal']);
  const colaRow = rows.find((r) => r[1] === 'Cola 33cl');
  assert.deepEqual(colaRow.slice(5, 8), ['1', '6', '30']);

  const pdf = Buffer.from(await (await pdfApi.onRequestGet(ctx(env, { params: { id: String(id) }, url: 'https://x/api/counts/1/pdf' }))).arrayBuffer()).toString('latin1');
  assert.match(pdf, /1 pak \+ 6/, 'de bestelbon toont de splitsing');
});

test('bedrijven zien elkaars producten, locaties en tellingen niet', async () => {
  const env = newEnv();
  const a = await seed(env, { name: 'STVV' });
  const b = await seed(env, { name: 'Bistro het Vinne' });
  assert.notEqual(a.co, b.co);

  const catA = await asJson(await catalogApi.onRequestGet(ctx(env, { url: `https://x/api/catalog?company_id=${a.co}&all=1` })));
  const catB = await asJson(await catalogApi.onRequestGet(ctx(env, { url: `https://x/api/catalog?company_id=${b.co}&all=1` })));
  assert.equal(catA.products.length, 3);
  assert.equal(catB.products.length, 3);
  assert.equal(catA.company.name, 'STVV');
  assert.deepEqual(catA.locations.map((l) => l.id).sort(), [a.loc, a.loc2].sort());
  assert.equal(catA.products.some((p) => catB.products.some((q) => q.id === p.id)), false, 'geen gedeelde producten');

  // dezelfde namen mogen twee keer bestaan, één keer per bedrijf
  const same = await companiesApi.onRequestPost(ctx(env, { method: 'POST', body: { name: 'STVV' } }));
  assert.equal(same.status, 409, 'bedrijfsnamen zijn wel uniek');

  // basisstock kan niet naar een locatie van een ander bedrijf gezet worden
  await productsApi.onRequestPut(ctx(env, { method: 'PUT', body: { id: a.cola, company_id: a.co, name: 'Cola 33cl', unit: 'blik', pack_size: 24, base: { [b.loc]: 99 } } }));
  const afterB = await asJson(await catalogApi.onRequestGet(ctx(env, { url: `https://x/api/catalog?company_id=${b.co}&location_id=${b.loc}` })));
  assert.equal(afterB.products.some((p) => p.id === a.cola), false, 'product van bedrijf A duikt niet op bij bedrijf B');

  await countsApi.onRequestPost(ctx(env, { method: 'POST', body: { location_id: a.loc, lines: [{ product_id: a.cola, loose: 1 }] } }));
  const listA = await asJson(await countsApi.onRequestGet(ctx(env, { url: `https://x/api/counts?company_id=${a.co}` })));
  const listB = await asJson(await countsApi.onRequestGet(ctx(env, { url: `https://x/api/counts?company_id=${b.co}` })));
  assert.equal(listA.counts.length, 1);
  assert.equal(listB.counts.length, 0);
  assert.equal(listA.counts[0].company_name, 'STVV');
});

test('een bedrijf verwijderen neemt zijn hele catalogus mee', async () => {
  const env = newEnv();
  const ids = await seed(env);
  const removed = await asJson(await companiesApi.onRequestDelete(ctx(env, { method: 'DELETE', url: `https://x/api/admin/companies?id=${ids.co}` })));
  assert.equal(removed.ok, true);
  const cat = await asJson(await catalogApi.onRequestGet(ctx(env, { url: `https://x/api/catalog?company_id=${ids.co}&all=1` })));
  assert.equal(cat.companies.length, 0);
  assert.equal((cat.products || []).length, 0);

  // met tellingen wordt het bedrijf gearchiveerd in plaats van verwijderd
  const other = await seed(env, { name: 'Bistro het Vinne' });
  await countsApi.onRequestPost(ctx(env, { method: 'POST', body: { location_id: other.loc, lines: [{ product_id: other.cola, loose: 2 }] } }));
  const archived = await asJson(await companiesApi.onRequestDelete(ctx(env, { method: 'DELETE', url: `https://x/api/admin/companies?id=${other.co}` })));
  assert.equal(archived.archived, true);
});


test('de bestellijst komt eruit als Excel in de vorm van de bestaande lijst', async () => {
  const env = newEnv();
  const ids = await seed(env);
  // twee locaties, dezelfde dag: dat wordt één werkboek met een kolom per locatie
  await countsApi.onRequestPost(ctx(env, { method: 'POST', body: {
    location_id: ids.loc, counted_on: '2026-09-09',
    lines: [{ product_id: ids.cola, packs: 0, loose: 0 }, { product_id: ids.chips, loose: 5 }, { product_id: ids.servet, loose: 10 }],
  } }));
  await countsApi.onRequestPost(ctx(env, { method: 'POST', body: {
    location_id: ids.loc2, counted_on: '2026-09-09', lines: [{ product_id: ids.cola, packs: 0, loose: 12 }],
  } }));

  const res = await xlsxApi.onRequestGet(ctx(env, { url: `https://x/api/export/xlsx?company_id=${ids.co}&date=2026-09-09` }));
  assert.equal(res.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(res.headers.get('content-disposition'), /2026_09_09_Bestellijst_STVV\.xlsx/);

  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.slice(0, 2).toString(), 'PK', 'een xlsx is een zip');
  const text = bytes.toString('latin1');
  assert.ok(text.includes('xl/workbook.xml') && text.includes('xl/worksheets/sheet1.xml'));
  assert.ok(text.includes('Drankencentrale'), 'een tabblad per leverancier');
  assert.ok(text.includes('Bar tribune 1') && text.includes('Magazijn'), 'een kolom per locatie');
  assert.ok(text.includes('Totaal'));
  assert.ok(text.includes('Cola 33cl'));
  assert.ok(/SUM\(B\d+:C\d+\)/.test(text), 'de kolom Totaal telt de locaties op');

  assert.equal(bestellijstNaam('Bistro het Vinne', '2026-09-09'), '2026_09_09_Bestellijst_Bistro_het_Vinne.xlsx');

  const single = await xlsxApi.onRequestGet(ctx(env, { url: 'https://x/api/export/xlsx?count_id=1' }));
  assert.equal(single.status, 200);
  const leeg = await xlsxApi.onRequestGet(ctx(env, { url: `https://x/api/export/xlsx?company_id=${ids.co}&date=2020-01-01` }));
  assert.equal(leeg.status, 404);
});


test('ontvangstcontrole: geleverde aantallen en het verschil met de bestelling', async () => {
  const env = newEnv();
  const ids = await seed(env);
  // basis 48 blik cola (2 bakken), niets geteld → 48 te bestellen; chips: basis 20, 5 geteld → 15
  const { id } = await asJson(await countsApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { location_id: ids.loc, lines: [
      { product_id: ids.cola, packs: 0, loose: 0 },
      { product_id: ids.chips, loose: 5 },
    ] },
  })));

  // één bak van 24 te weinig geleverd, chips kloppen
  const na = await asJson(await receiptApi.onRequestPut(ctx(env, {
    method: 'PUT', params: { id: String(id) },
    body: { lines: [
      { product_id: ids.cola, packs: 1, loose: 0 },
      { product_id: ids.chips, loose: 15 },
    ] },
  })));
  const cola = na.lines.find((l) => l.product_id === ids.cola);
  const chips = na.lines.find((l) => l.product_id === ids.chips);
  assert.equal(cola.order_qty, 48);
  assert.equal(cola.received_qty, 24, '1 bak van 24');
  assert.equal(cola.received_diff, -24, 'een bak te weinig');
  assert.equal(chips.received_diff, 0, 'chips kloppen');
  assert.equal(na.count.status, 'open', 'tussentijds bewaren sluit de levering niet af');

  // niet ingevulde regels blijven "nog niet nagekeken"
  const servet = na.lines.find((l) => l.product_id === ids.servet);
  assert.equal(servet.received_qty, null);

  const af = await asJson(await receiptApi.onRequestPut(ctx(env, {
    method: 'PUT', params: { id: String(id) }, body: { lines: [], complete: true },
  })));
  assert.equal(af.count.status, 'geleverd');
  assert.ok(af.count.received_at, 'het tijdstip van nakijken wordt bewaard');
  assert.equal(af.lines.find((l) => l.product_id === ids.cola).received_qty, 24, 'wat al ingevuld was, blijft staan');

  // een afgesloten telling laat zich niet meer aanpassen
  const geblokkeerd = await countApi.onRequestPut(ctx(env, { method: 'PUT', params: { id: String(id) }, body: { lines: [] } }));
  assert.equal(geblokkeerd.status, 409);

  // de CSV draagt de ontvangst mee
  const csv = await (await csvApi.onRequestGet(ctx(env, { params: { id: String(id) }, url: 'https://x/api/counts/1/csv' }))).text();
  assert.match(csv, /Geleverd/);
  assert.match(csv, /-24/);
});

test('toegangscodes beheren: de laatste volledige code blijft staan', async () => {
  const env = newEnv();
  const ids = await seed(env);
  // schema.sql zet '1011' klaar als code met volledige toegang
  let codes = (await asJson(await codesApi.onRequestGet(ctx(env)))).codes;
  assert.deepEqual(codes.map((c) => c.code), ['1011']);

  const laatste = await codesApi.onRequestDelete(ctx(env, { method: 'DELETE', url: 'https://x/api/admin/codes?code=1011' }));
  assert.equal(laatste.status, 409, 'de enige volledige code laat zich niet wissen');

  codes = (await asJson(await codesApi.onRequestPost(ctx(env, {
    method: 'POST', body: { code: '8956', label: 'Tellen STVV', role: 'teller', company_id: ids.co },
  })))).codes;
  assert.equal(codes.length, 2);
  assert.equal(codes.find((c) => c.code === '8956').company_name, 'STVV');

  const kort = await codesApi.onRequestPost(ctx(env, { method: 'POST', body: { code: '12', label: 'te kort' } }));
  assert.equal(kort.status, 400);

  // een tellercode komt niet in het codebeheer
  const teller = { email: '', admin: true, admin_list_set: false, protected: false,
    code: { label: 'Tellen STVV', role: 'teller', company_id: ids.co } };
  assert.equal((await codesApi.onRequestGet(ctx(env, { user: teller }))).status, 403);
});

test('overzicht: wat er vandaag geteld en te bestellen is', async () => {
  const env = newEnv();
  const ids = await seed(env);
  const leeg = await asJson(await dashboardApi.onRequestGet(ctx(env, { url: `https://x/api/dashboard?company_id=${ids.co}` })));
  assert.equal(leeg.counted_today.length, 0);
  assert.deepEqual(leeg.not_counted_today.map((l) => l.name), ['Bar tribune 1', 'Magazijn']);
  assert.match(leeg.warnings.join(' '), /Servetten|zonder leverancier/);

  // twee tellingen van vandaag op dezelfde locatie zouden dubbel tellen; hier één telling
  const { id } = await asJson(await countsApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { location_id: ids.loc, lines: [{ product_id: ids.cola, packs: 1 }, { product_id: ids.chips, loose: 5 }] },
  })));

  let dash = await asJson(await dashboardApi.onRequestGet(ctx(env, { url: `https://x/api/dashboard?company_id=${ids.co}` })));
  assert.equal(dash.counted_today.length, 1);
  const drank = dash.to_order.find((g) => g.supplier_name === 'Drankencentrale');
  assert.equal(drank.lines.find((l) => l.product_name === 'Cola 33cl').order_qty, 24, '48 basis − 24 geteld = 1 bak');
  assert.equal(drank.lines.find((l) => l.product_name === 'Chips paprika').order_qty, 15);

  // eens besteld verdwijnt ze uit 'te bestellen' en verschijnt ze bij 'na te kijken'
  await countApi.onRequestPatch(ctx(env, { method: 'PATCH', params: { id: String(id) }, body: { status: 'besteld' } }));
  dash = await asJson(await dashboardApi.onRequestGet(ctx(env, { url: `https://x/api/dashboard?company_id=${ids.co}` })));
  assert.equal(dash.to_order.length, 0);
  assert.equal(dash.open_orders.length, 1);
  assert.equal(dash.open_orders[0].location_name, 'Bar tribune 1');

  // een levering die niet klopt, komt in het overzicht
  await receiptApi.onRequestPut(ctx(env, {
    method: 'PUT', params: { id: String(id) }, body: { lines: [{ product_id: ids.cola, packs: 0, loose: 12 }], complete: true },
  }));
  dash = await asJson(await dashboardApi.onRequestGet(ctx(env, { url: `https://x/api/dashboard?company_id=${ids.co}` })));
  assert.equal(dash.open_orders.length, 0, 'nagekeken leveringen staan niet meer open');
  assert.equal(dash.differences.length, 1);
  assert.equal(dash.differences[0].diff, -12);
});

test('kassanamen herkennen: inhoud, product en toog', () => {
  assert.equal(inhoud('Jupiler 50l'), 50, 'een vat');
  assert.equal(inhoud('Coca cola 24X25cl'), 0.25, 'één flesje uit de bak, niet de hele bak');
  assert.equal(inhoud('Jupiler 30cl 3,3'), 0.3, '3,3 achteraan is de prijs, geen inhoud');
  assert.equal(inhoud('Chips Paprika 2,5'), null, 'geen maat in de naam');

  const producten = [
    { id: 1, name: 'Jupiler 50l', unit: 'vat' },
    { id: 2, name: 'Coca cola 24X25cl', unit: 'fles' },
  ];
  const bier = stelProductVoor('Jupiler 30cl 3,3', producten);
  assert.equal(bier.product_id, 1);
  assert.equal(bier.units_per_sale, 0.006, 'een glas van 30 cl uit een vat van 50 l');
  assert.equal(stelProductVoor('Coca Cola 3', producten).units_per_sale, 1, 'zonder maat: één op één');
  assert.equal(stelProductVoor('Waarborg beker -€2', producten), null, 'geen product, dus geen voorstel');

  const locaties = [{ id: 3, name: 'Toog 2' }, { id: 4, name: 'Toog 5' }, { id: 5, name: 'Noord' }];
  assert.equal(stelLocatieVoor('Oost - Toog 2', locaties).location_id, 3);
  assert.equal(stelLocatieVoor('Oost - Toog 5: BinkieBar', locaties).location_id, 4, 'de toog achter de bijnaam');
  assert.equal(stelLocatieVoor('Noord - Kant West', locaties).location_id, 5);
  assert.equal(stelLocatieVoor('Beer bar', locaties), null, 'geen toog in de voorraad');
});

test('verschil tussen verkoop en stock: wat is er weg zonder verkocht te zijn', async () => {
  const env = newEnv();
  const { id: co } = await asJson(await companiesApi.onRequestPost(ctx(env, { method: 'POST', body: { name: 'STVV' } })));
  const toog = await asJson(await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: co, name: 'Toog 2' } })));
  const vat = await asJson(await productsApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { company_id: co, name: 'Jupiler 50l', unit: 'vat', pack_size: 1, base: { [toog.id]: 10 } },
  })));

  // telling vóór de wedstrijd: 8 vaten in huis, dus 2 besteld; die 2 zijn ook geleverd
  const voor = await asJson(await countsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { location_id: toog.id, counted_on: '2026-09-01', lines: [{ product_id: vat.id, loose: 8 }] },
  })));
  let detail = await asJson(await countApi.onRequestGet(ctx(env, { params: { id: String(voor.id) } })));
  assert.equal(detail.lines[0].order_qty, 2, '10 basis − 8 geteld');
  await receiptApi.onRequestPut(ctx(env, {
    method: 'PUT', params: { id: String(voor.id) }, body: { lines: [{ product_id: vat.id, loose: 2 }], complete: true },
  }));

  // de wedstrijd: 1000 glazen van 30 cl verkocht = 6 vaten
  const rapport = await asJson(await salesApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { company_id: co, label: 'Speeldag 10', sold_on: '2026-09-05', rows: [
      { location: 'Oost - Toog 2', article: 'Jupiler 30cl 3,3', qty: 1000, revenue: 3300 },
      { location: 'Oost - Toog 2', article: 'Waarborg beker -€2', qty: 500, revenue: -1000 },
    ] },
  })));

  // zolang niets gekoppeld is, staan de namen bij de losse artikelen
  let verschil = await asJson(await salesReportApi.onRequestGet(ctx(env, { params: { id: String(rapport.id) } })));
  assert.equal(verschil.rows.length, 0);
  assert.deepEqual(verschil.unmapped_articles.map((a) => a.name).sort(), ['Jupiler 30cl 3,3', 'Waarborg beker -€2']);

  // het koppelscherm stelt de vertaling zelf voor
  const mapping = await asJson(await salesMapApi.onRequestGet(ctx(env, { url: `https://x/api/admin/sales-mapping?company_id=${co}` })));
  const bier = mapping.articles.find((a) => a.name === 'Jupiler 30cl 3,3');
  assert.equal(bier.suggestion.product_id, vat.id);
  assert.equal(bier.suggestion.units_per_sale, 0.006);
  assert.equal(mapping.sales_locations.find((l) => l.name === 'Oost - Toog 2').suggestion.location_id, toog.id);

  await salesMapApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { company_id: co,
      articles: [
        { name: 'Jupiler 30cl 3,3', product_id: vat.id, units_per_sale: 0.006 },
        { name: 'Waarborg beker -€2', ignored: true },
      ],
      locations: [{ name: 'Oost - Toog 2', location_id: toog.id }] },
  }));

  // zonder eindtelling valt er nog niets te vergelijken
  verschil = await asJson(await salesReportApi.onRequestGet(ctx(env, { params: { id: String(rapport.id) } })));
  assert.equal(verschil.rows.length, 0);
  assert.match(verschil.warnings.join(' '), /nog geen telling ná/);

  // telling ná de wedstrijd: er staan nog 3 vaten
  await countsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { location_id: toog.id, counted_on: '2026-09-08', lines: [{ product_id: vat.id, loose: 3 }] },
  }));

  verschil = await asJson(await salesReportApi.onRequestGet(ctx(env, { params: { id: String(rapport.id) } })));
  assert.equal(verschil.rows.length, 1);
  const rij = verschil.rows[0];
  assert.equal(rij.begin, 8);
  assert.equal(rij.geleverd, 2);
  assert.equal(rij.eind, 3);
  assert.equal(rij.geleverd_nagekeken, true);
  assert.equal(rij.verbruikt, 7, '8 + 2 − 3');
  assert.equal(rij.verkocht, 6, '1000 × 0,006 vat');
  assert.equal(rij.verschil, 1, 'één vat weg zonder verkoop');
  assert.equal(rij.waarde, 550, '3300 euro voor 6 vaten → 550 per vat');
  assert.equal(verschil.unmapped_articles.length, 0, 'de waarborg telt niet mee maar staat ook niet als los artikel');
  assert.equal(verschil.totals.omzet, 2300, 'omzet is inclusief de waarborgregels');
});

test('actuele stock: telling, levering, handmatige beweging en verkoop bij elkaar', async () => {
  const env = newEnv();
  const ids = await seed(env);

  // reden aanmaken en de telling zetten: 48 basis cola, 24 geteld → 24 besteld
  const reden = await asJson(await reasonsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { company_id: ids.co, name: 'Drank Rode Kruis', direction: 'uit' },
  })));
  const { id } = await asJson(await countsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { location_id: ids.loc, counted_on: '2026-09-01', lines: [{ product_id: ids.cola, loose: 24 }] },
  })));

  let stock = (await asJson(await stockApi.onRequestGet(ctx(env, { url: `https://x/api/stock?company_id=${ids.co}&location_id=${ids.loc}` })))).stock;
  let cola = stock.find((r) => r.product_id === ids.cola);
  assert.equal(cola.geteld, 24);
  assert.equal(cola.nu, 24, 'zonder levering of beweging staat er wat er geteld is');
  assert.equal(cola.besteld_niet_geleverd, 24, 'de bestelling is nog niet nagekeken');

  // levering inboeken: één bak van 24 kwam binnen
  await receiptApi.onRequestPut(ctx(env, {
    method: 'PUT', params: { id: String(id) }, body: { lines: [{ product_id: ids.cola, packs: 1 }], complete: true },
  }));
  // twee bakken naar het Rode Kruis
  const beweging = await movesApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { location_id: ids.loc, product_id: ids.cola, qty: -48, reason_id: reden.id, note: 'twee bakken' },
  }));
  assert.equal(beweging.status, 201);

  stock = (await asJson(await stockApi.onRequestGet(ctx(env, { url: `https://x/api/stock?company_id=${ids.co}&location_id=${ids.loc}` })))).stock;
  cola = stock.find((r) => r.product_id === ids.cola);
  assert.equal(cola.geleverd, 24);
  assert.equal(cola.bewegingen, -48);
  assert.equal(cola.besteld_niet_geleverd, 0, 'de levering is nagekeken');
  assert.equal(cola.nu, 0, '24 geteld + 24 geleverd − 48 weggegeven');

  // de tijdlijn vertelt hetzelfde verhaal, van nieuw naar oud
  const lijn = await asJson(await stockApi.onRequestGet(ctx(env, {
    url: `https://x/api/stock?company_id=${ids.co}&location_id=${ids.loc}&product_id=${ids.cola}&timeline=1`,
  })));
  assert.equal(lijn.product.name, 'Cola 33cl');
  assert.deepEqual(lijn.events.map((e) => e.soort), ['beweging', 'levering', 'telling']);
  assert.equal(lijn.events[0].tekst, 'Drank Rode Kruis');
  assert.equal(lijn.events[0].saldo, 0, 'stand na de laatste gebeurtenis');
  assert.equal(lijn.events[1].saldo, 48, 'na de levering stonden er 48');
  assert.equal(lijn.events[2].saldo, 24, 'de telling zet de stand vast');
});

test('een reden die al gebruikt is, verdwijnt niet zomaar', async () => {
  const env = newEnv();
  const ids = await seed(env);
  const reden = await asJson(await reasonsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { company_id: ids.co, name: 'Drank bussen' },
  })));
  await countsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { location_id: ids.loc, lines: [{ product_id: ids.cola, loose: 10 }] },
  }));
  await movesApi.onRequestPost(ctx(env, {
    method: 'POST', body: { location_id: ids.loc, product_id: ids.cola, qty: -6, reason_id: reden.id },
  }));

  const res = await asJson(await reasonsApi.onRequestDelete(ctx(env, { method: 'DELETE', url: `https://x/api/admin/reasons?id=${reden.id}` })));
  assert.equal(res.archived, true);
  const over = await asJson(await reasonsApi.onRequestGet(ctx(env, { url: `https://x/api/admin/reasons?company_id=${ids.co}` })));
  assert.equal(over.reasons[0].active, 0, 'op non-actief, niet weg');

  // en de beweging zelf blijft leesbaar
  const moves = await asJson(await movesApi.onRequestGet(ctx(env, { url: `https://x/api/moves?company_id=${ids.co}` })));
  assert.equal(moves.moves[0].reason_name, 'Drank bussen');
  assert.equal(moves.moves[0].qty, -6);
});

test('een beweging kan niet naar een product van een ander bedrijf', async () => {
  const env = newEnv();
  const ids = await seed(env);
  const ander = await asJson(await companiesApi.onRequestPost(ctx(env, { method: 'POST', body: { name: 'Bistro het Vinne' } })));
  const plek = await asJson(await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: ander.id, name: 'Bar' } })));
  const res = await movesApi.onRequestPost(ctx(env, {
    method: 'POST', body: { location_id: plek.id, product_id: ids.cola, qty: -1 },
  }));
  assert.equal(res.status, 400);
  assert.match((await asJson(res)).error, /hoort niet bij dit bedrijf/);
});
