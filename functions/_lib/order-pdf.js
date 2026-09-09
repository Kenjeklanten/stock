/**
 * Bestelbon (A4 staand) op basis van een telling. Eén sectie per leverancier, elk op een
 * nieuwe pagina, zodat je de bon rechtstreeks kan doorsturen of afdrukken.
 *
 * buildOrderPdf({ count, groups }) → Uint8Array  (count draagt de bedrijfsgegevens)
 */
import { Pdf, A4, ellipsis } from './pdf.js';
import { fmt, orderPacks } from './order.js';

const INK = '#111827', MUTED = '#6B7280', RULE = '#D1D5DB', ZEBRA = '#F3F4F6', HEAD = '#111827';
const M = 42;                       // marge links/rechts
const TOP = A4.h - 46, BOTTOM = 76; // schrijfgebied

const COLS = [
  { key: 'sku',    label: 'Art.nr',     w: 50,  align: 'left' },
  { key: 'name',   label: 'Product',    w: 140, align: 'left' },
  { key: 'unit',   label: 'Eenheid',    w: 44,  align: 'left' },
  { key: 'base',   label: 'Basis',      w: 38,  align: 'right' },
  { key: 'split',  label: 'Pak + los',  w: 62,  align: 'left' },
  { key: 'count',  label: 'Geteld',     w: 44,  align: 'right' },
  { key: 'order',  label: 'Bestellen',  w: 54,  align: 'right' },
  { key: 'packs',  label: 'Verpakking', w: 75,  align: 'left' },
];

const plural = (n, one, many) => `${fmt(n)} ${Number(n) === 1 ? one : many}`;

const dateNl = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso || ''))) return String(iso || '');
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};

function header(doc, { count, group, totalGroups, index }) {
  let y = TOP;
  doc.fill(INK).text(count.company_name || 'Besteltool', M, y, 17, { bold: true });
  doc.fill(MUTED);
  if (count.company_address) doc.text(count.company_address, M, y - 14, 8.5);
  const vat = [count.company_vat && `BTW ${count.company_vat}`, count.company_email].filter(Boolean).join('  ·  ');
  if (vat) doc.text(vat, M, y - 25, 8.5);

  doc.fill(INK).text('BESTELBON', A4.w - M, y, 15, { bold: true, align: 'right' });
  doc.fill(MUTED).text(`nr. ${count.id}${totalGroups > 1 ? `-${index + 1}` : ''}  ·  ${dateNl(count.counted_on)}`, A4.w - M, y - 14, 9, { align: 'right' });

  y -= 44;
  doc.stroke(RULE).line(M, y, A4.w - M, y, 0.8);

  y -= 18;
  const col2 = M + 250;
  const pair = (label, value, x, yy) => {
    doc.fill(MUTED).text(label, x, yy, 8.5);
    doc.fill(INK).text(ellipsis(value || '—', 10.5, true, 230), x, yy - 13, 10.5, { bold: true });
  };
  pair('Leverancier', group.supplier_name, M, y);
  pair('Locatie', count.location_name, col2, y);
  y -= 32;
  pair('Klantnummer', group.customer_ref || '—', M, y);
  pair('Telling van', `${dateNl(count.counted_on)}${count.created_by ? ` · ${count.created_by}` : ''}`, col2, y);
  y -= 34;

  if (count.note) {
    doc.fill(MUTED).text('Opmerking', M, y, 8.5);
    doc.fill(INK).text(ellipsis(count.note, 9.5, false, A4.w - 2 * M), M, y - 12, 9.5);
    y -= 30;
  }
  return y;
}

function tableHead(doc, y) {
  doc.fill(HEAD).rect(M, y - 4, A4.w - 2 * M, 18);
  let x = M + 6;
  doc.fill('#FFFFFF');
  for (const c of COLS) {
    doc.text(c.label, c.align === 'right' ? x + c.w - 12 : x, y + 2, 8.5, { bold: true, align: c.align === 'right' ? 'right' : 'left' });
    x += c.w;
  }
  return y - 20;
}

function row(doc, y, line, zebra) {
  if (zebra) doc.fill(ZEBRA).rect(M, y - 5, A4.w - 2 * M, 16);
  const packs = orderPacks(line.order_qty, line.pack_size);
  const notCounted = line.counted_qty === null || line.counted_qty === undefined;
  const values = {
    sku: line.sku || '',
    name: line.product_name,
    unit: line.unit || 'stuk',
    base: fmt(line.base_qty),
    split: notCounted || line.counted_packs === null || line.counted_packs === undefined
      ? '' : `${fmt(line.counted_packs)} pak + ${fmt(line.counted_loose || 0)}`,
    count: notCounted ? '—' : fmt(line.counted_qty),
    order: fmt(line.order_qty),
    packs: Number(line.pack_size) > 1 ? `${fmt(packs)} × ${line.pack_label || `${fmt(line.pack_size)} ${line.unit || 'stuk'}`}` : '',
  };
  let x = M + 6;
  for (const c of COLS) {
    const bold = c.key === 'order';
    doc.fill(c.key === 'order' ? INK : (c.key === 'name' ? INK : MUTED));
    const value = ellipsis(values[c.key], 9, bold, c.w - 10);
    doc.text(value, c.align === 'right' ? x + c.w - 12 : x, y, 9, { bold, align: c.align === 'right' ? 'right' : 'left' });
    x += c.w;
  }
  return y - 16;
}

export function buildOrderPdf({ count, groups }) {
  const doc = new Pdf(A4);
  const list = groups.length ? groups : [{ supplier_name: 'Geen bestelling', customer_ref: '', lines: [] }];

  list.forEach((group, index) => {
    if (index > 0) doc.newPage();
    let y = header(doc, { count, group, totalGroups: list.length, index });
    y = tableHead(doc, y);

    let zebra = false;
    for (const line of group.lines) {
      if (y < BOTTOM + 24) {
        doc.newPage();
        y = TOP - 20;
        doc.fill(MUTED).text(`${count.company_name || ''} · bestelbon ${count.id} · ${group.supplier_name} (vervolg)`, M, y, 9);
        y = tableHead(doc, y - 22);
        zebra = false;
      }
      y = row(doc, y, line, zebra);
      zebra = !zebra;
    }

    const units = group.lines.reduce((a, l) => a + Number(l.order_qty || 0), 0);
    const colli = group.lines.reduce((a, l) => a + orderPacks(l.order_qty, l.pack_size), 0);
    y -= 6;
    doc.stroke(RULE).line(M, y, A4.w - M, y, 0.8);
    y -= 16;
    doc.fill(INK).text(`${plural(group.lines.length, 'bestelregel', 'bestelregels')}  ·  ${plural(units, 'eenheid', 'eenheden')}  ·  ${plural(colli, 'verpakking', 'verpakkingen')}`, M, y, 9.5, { bold: true });
    if (!group.lines.length) doc.fill(MUTED).text('Alle producten zijn op basisstock — er hoeft niets besteld te worden.', M, y - 16, 9.5);
  });

  const footerText = count.company_footer || '';
  doc.eachPage((page, total) => {
    doc.stroke(RULE).line(M, BOTTOM - 6, A4.w - M, BOTTOM - 6, 0.6);
    doc.fill(MUTED);
    if (footerText) doc.text(ellipsis(footerText, 8.5, false, A4.w - 2 * M - 90), M, BOTTOM - 20, 8.5);
    doc.text(`pagina ${page} van ${total}`, A4.w - M, BOTTOM - 20, 8.5, { align: 'right' });
  });

  return doc.build();
}
