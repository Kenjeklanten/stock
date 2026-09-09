/**
 * POST /api/admin/import
 *   { company_id, mode: 'preview' | 'apply', csv: "..." }                      ← CSV plakken of kiezen
 *   { company_id, mode, sheets: [...], values: 'base' | 'ignore' }             ← uit een xlsx (bestellijst)
 *
 * Alles wordt binnen dat ene bedrijf aangemaakt of bijgewerkt; bedrijven delen niets.
 *
 * CSV-kolommen (hoofdletters en accenten maken niet uit):
 *   Product | Artikelnummer | Eenheid | Verpakking | Verpakkingsnaam | Categorie | Leverancier
 * Elke overige kolom is een locatie: de waarde is de basisstock van dat product daar.
 * Een lege cel betekent "dit product staat niet in die locatie".
 *
 * Bij een xlsx in de vorm van de bestellijst is elk tabblad een leverancier, staan de locaties
 * in de kopregel en zijn de blokken (PET, EXTRA, …) categorieën. `values` zegt of de getallen
 * in het bestand de basisstock zijn of alleen producten en locaties moeten opleveren.
 */
import { json, handler, db, body, int, num, text, HttpError } from '../../_lib/http.js';
import { parseCsv } from '../../_lib/csv.js';
import { guard, requireCompany } from './_guard.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

const ALIASES = {
  name: ['product', 'productnaam', 'naam', 'omschrijving', 'artikel'],
  sku: ['artikelnummer', 'artikelnr', 'sku', 'code', 'artikelcode'],
  unit: ['eenheid', 'unit'],
  pack_size: ['verpakking', 'verpakkingsgrootte', 'packsize', 'besteleenheid', 'inhoud'],
  pack_label: ['verpakkingsnaam', 'verpakkingslabel', 'colli', 'packlabel'],
  category: ['categorie', 'category', 'groep', 'afdeling'],
  supplier: ['leverancier', 'supplier'],
};

const chunk = (arr, size = 40) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const item = (fields) => ({
  name: '', sku: '', unit: 'stuk', pack_size: 1, pack_label: '', category: '', supplier: '', base: {}, ...fields,
});

/** CSV → locatiekolommen en producten. */
function fromCsv(csv) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new HttpError('Plak of kies een CSV met een koprij en minstens één product.');

  const header = rows[0].map((h) => text(h, 60));
  const fieldOf = {};
  const locationCols = [];
  header.forEach((label, i) => {
    const key = Object.keys(ALIASES).find((k) => ALIASES[k].includes(norm(label)));
    if (key && fieldOf[key] === undefined) fieldOf[key] = i;
    else if (label) locationCols.push({ index: i, name: label });
  });
  if (fieldOf.name === undefined) throw new HttpError('Er is geen kolom "Product" gevonden in de kopregel.');

  const warnings = [];
  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const cell = (i) => (i === undefined ? '' : text(row[i], 200));
    const name = cell(fieldOf.name);
    if (!name) continue;
    const base = {};
    for (const col of locationCols) {
      const raw = cell(col.index);
      if (raw === '') continue;
      const qty = num(raw, null);
      if (qty === null) { warnings.push(`Rij ${r + 1}: "${raw}" bij ${col.name} is geen getal — overgeslagen.`); continue; }
      base[col.name] = Math.max(0, qty);
    }
    items.push(item({
      name, base,
      sku: cell(fieldOf.sku),
      unit: cell(fieldOf.unit) || 'stuk',
      pack_size: Math.max(num(cell(fieldOf.pack_size), 1) || 1, 0.01),
      pack_label: cell(fieldOf.pack_label),
      category: cell(fieldOf.category),
      supplier: cell(fieldOf.supplier),
    }));
  }
  return { locationNames: locationCols.map((c) => c.name), items, warnings, exclusive: true };
}

/**
 * Tabbladen uit een xlsx (door de browser ingelezen) → producten per leverancier.
 * values === 'base': de getallen in het bestand zijn de basisstock; anders worden enkel de
 * producten en locaties overgenomen en blijft de basisstock leeg.
 */
function fromSheets(sheets, values) {
  if (!Array.isArray(sheets) || !sheets.length) throw new HttpError('Geen bruikbare tabbladen in het bestand.');
  const useBase = values === 'base';
  const locationNames = [];
  const items = [];
  const warnings = [];

  for (const sheet of sheets) {
    const supplier = text(sheet.name, 80);
    for (const name of sheet.locations || []) {
      const clean = text(name, 80);
      if (clean && !locationNames.some((l) => norm(l) === norm(clean))) locationNames.push(clean);
    }
    for (const product of sheet.products || []) {
      const productName = text(product.name, 120);
      if (!productName) continue;
      const base = {};
      if (useBase) {
        for (const [location, value] of Object.entries(product.values || {})) {
          const qty = num(value, null);
          if (qty === null) continue;
          base[text(location, 80)] = Math.max(0, qty);
        }
      }
      items.push(item({ name: productName, supplier, category: text(product.category, 60), base }));
    }
  }
  if (!items.length) throw new HttpError('Geen producten gevonden in de tabbladen.');
  if (!useBase) warnings.push('De getallen uit het bestand zijn niet overgenomen: vul de basisstock nog in bij Producten & basisstock.');
  return { locationNames, items, warnings, exclusive: false };
}

export const onRequestPost = handler(async ({ request, env, data }) => {
  const D = db(env);
  const input = (await body(request)) || {};
  const companyId = int(input.company_id, null);
  requireCompany(await guard(env, data), companyId, { manage: true });
  const company = await D.prepare('SELECT id, name FROM companies WHERE id = ?1').bind(companyId).first();
  if (!company) throw new HttpError('Onbekend bedrijf.', 404);

  const apply = input.mode === 'apply';
  const parsed = input.sheets ? fromSheets(input.sheets, input.values) : fromCsv(input.csv);
  const { locationNames, items, warnings } = parsed;

  const [existingLocations, existingSuppliers, existingProducts] = await Promise.all([
    D.prepare('SELECT id, name FROM locations WHERE company_id = ?1').bind(companyId).all(),
    D.prepare('SELECT id, name FROM suppliers WHERE company_id = ?1').bind(companyId).all(),
    D.prepare('SELECT id, name, supplier_id FROM products WHERE company_id = ?1').bind(companyId).all(),
  ]);
  const locByName = new Map((existingLocations.results || []).map((r) => [norm(r.name), r]));
  const supByName = new Map((existingSuppliers.results || []).map((r) => [norm(r.name), r]));
  const prodByKey = new Map((existingProducts.results || []).map((r) => [`${norm(r.name)}|${r.supplier_id || 0}`, r]));
  // Een leverancier die nog niet bestaat kan nooit matchen met een bestaand product.
  const supKey = (name) => {
    if (!name) return 0;
    const known = supByName.get(norm(name));
    return known ? known.id : `nieuw:${norm(name)}`;
  };

  const report = {
    company: company.name,
    rows: items.length,
    locations_used: locationNames,
    locations_new: locationNames.filter((n) => !locByName.has(norm(n))),
    suppliers_new: [],
    products_new: 0,
    products_updated: 0,
    par_rows: items.reduce((a, p) => a + Object.keys(p.base).length, 0),
    warnings: [...warnings],
  };
  for (const p of items) {
    if (p.supplier && !supByName.has(norm(p.supplier)) && !report.suppliers_new.includes(p.supplier)) report.suppliers_new.push(p.supplier);
    if (prodByKey.has(`${norm(p.name)}|${supKey(p.supplier)}`)) report.products_updated++;
    else report.products_new++;
  }

  if (!apply) return json({ preview: true, report, sample: items.slice(0, 8) });

  for (const name of report.locations_new) {
    const res = await D.prepare('INSERT INTO locations (company_id, name) VALUES (?1, ?2)').bind(companyId, name).run();
    locByName.set(norm(name), { id: res.meta.last_row_id, name });
  }
  for (const name of report.suppliers_new) {
    const res = await D.prepare('INSERT INTO suppliers (company_id, name) VALUES (?1, ?2)').bind(companyId, name).run();
    supByName.set(norm(name), { id: res.meta.last_row_id, name });
  }

  const parStatements = [];
  for (const p of items) {
    const supId = p.supplier ? supByName.get(norm(p.supplier)).id : null;
    const known = prodByKey.get(`${norm(p.name)}|${supId || 0}`);
    let id;
    if (known) {
      id = known.id;
      await D.prepare(
        'UPDATE products SET sku = ?2, unit = ?3, pack_size = ?4, pack_label = ?5, category = ?6, active = 1 WHERE id = ?1'
      ).bind(id, p.sku, p.unit, p.pack_size, p.pack_label, p.category).run();
    } else {
      const res = await D.prepare(
        `INSERT INTO products (company_id, name, sku, unit, pack_size, pack_label, category, supplier_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      ).bind(companyId, p.name, p.sku, p.unit, p.pack_size, p.pack_label, p.category, supId).run();
      id = res.meta.last_row_id;
      prodByKey.set(`${norm(p.name)}|${supId || 0}`, { id, name: p.name, supplier_id: supId });
    }

    for (const name of locationNames) {
      const location = locByName.get(norm(name));
      if (!location) continue;
      const qty = p.base[name] ?? p.base[Object.keys(p.base).find((k) => norm(k) === norm(name)) ?? ''];
      if (qty === undefined) {
        // Bij een CSV is een lege cel een bewuste keuze: het product hoort daar niet.
        // Bij een xlsx zonder basisstock blijft alles staan wat er al was.
        if (parsed.exclusive) parStatements.push(D.prepare('DELETE FROM par_levels WHERE location_id = ?1 AND product_id = ?2').bind(location.id, id));
        continue;
      }
      parStatements.push(D.prepare(
        `INSERT INTO par_levels (location_id, product_id, base_qty) VALUES (?1, ?2, ?3)
         ON CONFLICT(location_id, product_id) DO UPDATE SET base_qty = excluded.base_qty`
      ).bind(location.id, id, qty));
    }
  }
  for (const batch of chunk(parStatements)) await D.batch(batch);

  return json({ preview: false, report });
});
