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
import * as settingsApi from '../functions/api/admin/settings.js';
import * as importApi from '../functions/api/admin/import.js';
import * as exportApi from '../functions/api/admin/export.js';
import * as catalogApi from '../functions/api/catalog.js';
import * as countsApi from '../functions/api/counts.js';
import * as countApi from '../functions/api/counts/[id].js';
import * as csvApi from '../functions/api/counts/[id]/csv.js';
import * as pdfApi from '../functions/api/counts/[id]/pdf.js';
import * as xlsxApi from '../functions/api/export/xlsx.js';
import { bestellijstNaam } from '../functions/_lib/bestellijst.js';

const schema = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql');
const newEnv = () => ({ DB: createDb(schema) });
const asJson = async (res) => JSON.parse(await res.text());

async function seed(env, { name = 'STVV' } = {}) {
  const company = await asJson(await companiesApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { name, address: 'Stayen 1, 3800 Sint-Truiden', vat: 'BE 0123.456.789', email: 'inkoop@stvv.example', order_footer: 'Leveren voor 10u.' },
  })));
  const co = company.id;
  const loc = await asJson(await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: co, name: 'Bar tribune 1' } })));
  const loc2 = await asJson(await locationsApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: co, name: 'Magazijn' } })));
  const sup = await asJson(await suppliersApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: co, name: 'Drankencentrale', customer_ref: 'KL-42' } })));
  const cola = await asJson(await productsApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { company_id: co, name: 'Cola 33cl', sku: 'C33', unit: 'blik', pack_size: 24, pack_label: 'bak van 24', category: 'Frisdrank', supplier_id: sup.id, base: { [loc.id]: 48, [loc2.id]: 24 } },
  })));
  const chips = await asJson(await productsApi.onRequestPost(ctx(env, {
    method: 'POST',
    body: { company_id: co, name: 'Chips paprika', sku: 'CP', unit: 'zak', pack_size: 1, category: 'Snacks', supplier_id: sup.id, base: { [loc.id]: 20 } },
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
  assert.equal(detail.orders[0].customer_ref, 'KL-42');
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
  assert.deepEqual(rows[1].slice(0, 4), ['Drankencentrale', 'KL-42', 'C33', 'Cola 33cl']);
  assert.equal(rows[1][12], '24', 'kolom "Te bestellen"');
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

test('CSV-import maakt producten, locaties en basisstock aan binnen één bedrijf', async () => {
  const env = newEnv();
  const { id: company } = await asJson(await companiesApi.onRequestPost(ctx(env, { method: 'POST', body: { name: 'Bistro het Vinne' } })));
  const csv = [
    'Product;Artikelnummer;Eenheid;Verpakking;Categorie;Leverancier;Bar;Keuken',
    'Cola 33cl;C33;blik;24;Frisdrank;Drankencentrale;48;12',
    'Koffiebonen;KB1;kg;1;Warme dranken;Koffie NV;6;',
    'Fout product;X;stuk;1;;;abc;3',
  ].join('\n');

  const preview = await asJson(await importApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: company, csv, mode: 'preview' } })));
  assert.equal(preview.preview, true);
  assert.equal(preview.report.products_new, 3);
  assert.deepEqual(preview.report.locations_new, ['Bar', 'Keuken']);
  assert.deepEqual(preview.report.suppliers_new, ['Drankencentrale', 'Koffie NV']);
  assert.equal(preview.report.warnings.length, 1, 'niet-numerieke basisstock geeft een waarschuwing');

  const applied = await asJson(await importApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: company, csv, mode: 'apply' } })));
  assert.equal(applied.preview, false);

  const cat = await asJson(await catalogApi.onRequestGet(ctx(env, { url: `https://x/api/catalog?company_id=${company}&all=1` })));
  assert.equal(cat.products.length, 3);
  assert.deepEqual(cat.locations.map((l) => l.name), ['Bar', 'Keuken']);
  assert.equal(preview.report.company, 'Bistro het Vinne');
  const cola = cat.products.find((p) => p.name === 'Cola 33cl');
  assert.equal(cola.pack_size, 24);
  assert.equal(Object.keys(cola.base).length, 2);

  // opnieuw importeren werkt bij: geen dubbele producten
  const again = await asJson(await importApi.onRequestPost(ctx(env, { method: 'POST', body: { company_id: company, csv, mode: 'apply' } })));
  assert.equal(again.report.products_new, 0);
  assert.equal(again.report.products_updated, 3);

  const exported = await (await exportApi.onRequestGet(ctx(env, { url: `https://x/api/admin/export?company_id=${company}` }))).text();
  const rows = parseCsv(exported);
  assert.deepEqual(rows[0].slice(0, 7), ['Product', 'Artikelnummer', 'Eenheid', 'Verpakking', 'Verpakkingsnaam', 'Categorie', 'Leverancier']);
  assert.equal(rows.length, 4);
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

test('beheer is afgeschermd en instellingen worden bewaard', async () => {
  const env = newEnv();
  // ADMIN_EMAILS is ingevuld en dit adres staat er niet bij: geen beheerrechten
  const denied = await locationsApi.onRequestPost(ctx(env, {
    method: 'POST', body: { company_id: 1, name: 'X' },
    user: { email: 'medewerker@jeconcept.be', admin: false, admin_listed: false, admin_list_set: true, protected: true },
  }));
  assert.equal(denied.status, 403);

  const saved = await asJson(await settingsApi.onRequestPost(ctx(env, { method: 'POST', body: { csv_delimiter: ',' } })));
  assert.equal(saved.settings.csv_delimiter, ',');
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
  assert.deepEqual(rows[0].slice(8, 11), ['Geteld volle pakken', 'Geteld losse stuks', 'Geteld totaal']);
  const colaRow = rows.find((r) => r[3] === 'Cola 33cl');
  assert.deepEqual(colaRow.slice(8, 11), ['1', '6', '30']);

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


test('xlsx-import: getallen in bakken worden omgerekend naar stuks', async () => {
  const env = newEnv();
  const ids = await seed(env);   // Cola 33cl zit in een bak van 24
  const sheets = [{
    name: 'Drankencentrale',
    locations: ['Bar tribune 1'],
    products: [
      { name: 'Cola 33cl', category: 'Frisdrank', values: { 'Bar tribune 1': 3 } },
      { name: 'Rietjes', category: '', values: { 'Bar tribune 1': 5 } },   // nieuw product, verpakking 1
    ],
  }];
  const res = await asJson(await importApi.onRequestPost(ctx(env, {
    method: 'POST', body: { company_id: ids.co, sheets, values: 'base_packs', mode: 'apply' },
  })));
  assert.equal(res.preview, false);
  assert.match(res.report.warnings.join(' '), /verpakking op 1/);

  const cat = await asJson(await catalogApi.onRequestGet(ctx(env, { url: `https://x/api/catalog?company_id=${ids.co}&location_id=${ids.loc}` })));
  const cola = cat.products.find((p) => p.name === 'Cola 33cl');
  assert.equal(cola.base_qty, 72, '3 bakken × 24 = 72 blik');
  const rietjes = cat.products.find((p) => p.name === 'Rietjes');
  assert.equal(rietjes.base_qty, 5, 'verpakking 1 → het getal blijft staan');

  // de verpakking van een bestaand product wordt niet overschreven door de import
  assert.equal(cola.pack_size, 24);

  // een product dat al onder een andere leverancier staat, geeft een waarschuwing
  const dubbel = await asJson(await importApi.onRequestPost(ctx(env, {
    method: 'POST', mode: 'preview',
    body: { company_id: ids.co, mode: 'preview', values: 'base_packs', sheets: [{
      name: 'Andere leverancier', locations: ['Bar tribune 1'],
      products: [{ name: 'Cola 33cl', values: { 'Bar tribune 1': 1 } }],
    }] },
  })));
  assert.match(dubbel.report.warnings.join(' '), /staat al onder/);
});
