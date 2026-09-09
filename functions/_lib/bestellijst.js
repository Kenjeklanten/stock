/**
 * De bestellijst als Excel-werkboek, in dezelfde vorm als de bestellijst die STVV vandaag
 * met de hand invult: één tabblad per leverancier, één kolom per locatie, de producten in
 * blokken per categorie en achteraan een kolom Totaal.
 *
 *   rij 1  Bestelbon:            <datum>
 *   rij 3  (leeg) | Toog 1 | Toog 2 | … | Totaal
 *   rij 4  Artikel
 *   rij 5+ productnaam | te bestellen per locatie … | =SOM(…)
 *          daarna per categorie een leeg rij + kopregel met de categorienaam in kolom A
 */
import { buildWorkbook, cellRef } from './xlsx.js';

const dateNl = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso || ''))) return String(iso || '');
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};

/**
 * rows: platte regels uit de tellingen
 *   { supplier_id, supplier_name, supplier_sort, category, product_id, product_name,
 *     product_sort, location_id, location_name, location_sort, order_qty }
 */
export function buildBestellijst({ company, date, rows }) {
  // per leverancier → per categorie → per product → per locatie het te bestellen aantal
  const suppliers = new Map();
  for (const r of rows) {
    const key = r.supplier_id ?? 0;
    if (!suppliers.has(key)) {
      suppliers.set(key, { id: r.supplier_id ?? null, name: r.supplier_name || 'Zonder leverancier', sort: r.supplier_sort ?? 999, products: new Map() });
    }
    const supplier = suppliers.get(key);
    if (!supplier.products.has(r.product_id)) {
      supplier.products.set(r.product_id, {
        id: r.product_id, name: r.product_name, category: r.category || '',
        sort: r.product_sort ?? 0, qty: new Map(),
      });
    }
    const product = supplier.products.get(r.product_id);
    const current = product.qty.get(r.location_id) || 0;
    product.qty.set(r.location_id, current + Number(r.order_qty || 0));
  }

  // locaties per leverancier: enkel de locaties waar producten van die leverancier geteld zijn
  const locationsOf = new Map();
  for (const r of rows) {
    const key = r.supplier_id ?? 0;
    if (!locationsOf.has(key)) locationsOf.set(key, new Map());
    locationsOf.get(key).set(r.location_id, { id: r.location_id, name: r.location_name, sort: r.location_sort ?? 0 });
  }

  const sheets = [...suppliers.values()]
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'nl'))
    .map((supplier) => {
      const cols = [...(locationsOf.get(supplier.id ?? 0) || new Map()).values()]
        .sort((a, b) => a.sort - b.sort || String(a.name).localeCompare(b.name, 'nl'));

      // volgorde van het beheerscherm; de categorieblokken volgen de volgorde waarin ze opduiken
      const products = [...supplier.products.values()]
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'nl'));
      const blocks = [];
      for (const product of products) {
        let block = blocks.find((b) => b.category === product.category);
        if (!block) { block = { category: product.category, products: [] }; blocks.push(block); }
        block.products.push(product);
      }
      blocks.sort((a, b) => (a.category ? 1 : 0) - (b.category ? 1 : 0));   // het blok zonder categorie eerst

      const headRow = (label) => [
        { v: label, style: label ? 'block' : 'plain' },
        ...cols.map((c) => ({ v: c.name, style: 'head' })),
        { v: 'Totaal', style: 'head' },
      ];

      const rowsOut = [
        [{ v: 'Bestelbon:', style: 'title' }, { v: dateNl(date), style: 'title' }],
        [],
      ];
      blocks.forEach((block, index) => {
        if (index > 0) rowsOut.push([]);                      // lege rij tussen de blokken
        if (index === 0 && !block.category) {
          rowsOut.push(headRow(''));                          // kopregel met de locaties
          rowsOut.push([{ v: 'Artikel', style: 'block' }]);   // en daaronder "Artikel", zoals in de lijst
        } else {
          rowsOut.push(headRow(block.category || 'Artikel'));
        }
        for (const product of block.products) {
          const rowNumber = rowsOut.length + 1;
          rowsOut.push([
            { v: product.name, style: 'name' },
            ...cols.map((c) => {
              const qty = product.qty.get(c.id) || 0;
              return { v: qty > 0 ? qty : '', style: 'num' };
            }),
            { f: `SUM(${cellRef(2, rowNumber)}:${cellRef(cols.length + 1, rowNumber)})`, style: 'total' },
          ]);
        }
      });
      if (!products.length) rowsOut.push(headRow(''));

      return { name: supplier.name, widths: [32, ...cols.map(() => 12), 10], rows: rowsOut };
    });

  return buildWorkbook(sheets.length ? sheets : [{ name: 'Bestelbon', rows: [[{ v: 'Geen bestelregels', style: 'title' }]] }]);
}

/** Bestandsnaam in de vorm 2026_09_09_Bestellijst_STVV.xlsx */
export const bestellijstNaam = (company, date) =>
  `${String(date).slice(0, 10).replace(/-/g, '_')}_Bestellijst_${String(company || 'bestelling').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}.xlsx`;
