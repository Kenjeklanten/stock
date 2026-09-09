// Ontvangstcontrole: is er geleverd wat er besteld was? Per product wordt geteld zoals bij de
// stocktelling — volle pakken + losse stuks — en het verschil met de bestelling staat ernaast.
import { api, toast, fmt, num, el, clear, qs, params, mountHeader, dateNl, plural } from './app.js';

let data = null;
const id = params().get('id');
const fields = new Map();   // product_id → { packs, loose, diff }

const packOf = (line) => (Number(line.pack_size) > 0 ? Number(line.pack_size) : 1);
const total = (line) => (num(fields.get(line.product_id).packs.value, 0) || 0) * packOf(line)
  + (num(fields.get(line.product_id).loose.value, 0) || 0);

/** Ingevuld? Een lege regel blijft "nog niet nagekeken". */
const touched = (line) => {
  const f = fields.get(line.product_id);
  return f.packs.value.trim() !== '' || f.loose.value.trim() !== '';
};

function showDiff(line) {
  const cell = fields.get(line.product_id).diff;
  clear(cell);
  if (!touched(line)) return cell.append(el('span', { class: 'muted', text: '—' }));
  const diff = total(line) - Number(line.order_qty);
  if (Math.abs(diff) < 0.001) return cell.append(el('span', { class: 'tag tag--mint', text: 'klopt' }));
  cell.append(el('span', {
    class: diff < 0 ? 'tag tag--danger' : 'tag tag--sun',
    text: `${diff > 0 ? '+' : ''}${fmt(diff)} ${line.unit}`,
  }));
}

function row(line) {
  const packs = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', 'aria-label': `Volle pakken ${line.product_name}` });
  const loose = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', 'aria-label': `Losse stuks ${line.product_name}` });
  const diff = el('td', { class: 'num' });
  if (line.received_qty !== null && line.received_qty !== undefined) {
    packs.value = line.received_packs === null || line.received_packs === undefined ? '' : String(line.received_packs);
    loose.value = line.received_loose === null || line.received_loose === undefined ? '' : String(line.received_loose);
  }
  fields.set(line.product_id, { packs, loose, diff });
  for (const input of [packs, loose]) input.addEventListener('input', () => showDiff(line));

  const verwacht = packOf(line) > 1
    ? `${fmt(line.order_packs)} × ${line.pack_label || `${fmt(line.pack_size)} ${line.unit}`}`
    : `${fmt(line.order_qty)} ${line.unit}`;

  const tr = el('tr', {}, [
    el('td', {}, [el('b', { text: line.product_name })]),
    el('td', { class: 'num', text: verwacht }),
    el('td', {}, [packs]),
    el('td', {}, [loose]),
    diff,
  ]);
  showDiff(line);
  return tr;
}

function supplierCard(group) {
  return el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [el('h2', { text: group.supplier_name })]),
    el('div', { class: 'table-wrap' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Product' }), el('th', { class: 'num', text: 'Besteld' }),
        el('th', { text: 'Volle pakken' }), el('th', { text: 'Losse stuks' }),
        el('th', { class: 'num', text: 'Verschil' }),
      ])]),
      el('tbody', {}, group.lines.map(row)),
    ])]),
  ]);
}

const payload = () => [...fields.entries()].map(([product_id, f]) => ({
  product_id,
  packs: f.packs.value.trim() === '' ? null : f.packs.value,
  loose: f.loose.value.trim() === '' ? null : f.loose.value,
}));

async function save(complete) {
  try {
    data = await api(`/api/counts/${encodeURIComponent(id)}/receipt`, {
      method: 'PUT', body: { lines: payload(), complete },
    });
    toast(complete ? 'Levering afgesloten.' : 'Bewaard.');
    if (complete) location.href = `/bestelling?id=${id}`;
  } catch (err) { toast(err.message, true); }
}

function head() {
  const c = data.count;
  const ordered = data.orders.reduce((a, g) => a + g.lines.length, 0);
  return el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [
      el('h1', { text: `Levering inboeken — ${c.location_name}` }),
      c.received_at ? el('span', { class: 'tag tag--mint', text: `nagekeken op ${dateNl(c.received_at.slice(0, 10))}` }) : null,
    ]),
    el('p', { class: 'muted small', text: `${c.company_name} · telling ${c.id} van ${dateNl(c.counted_on)} · ${plural(ordered, 'bestelregel', 'bestelregels')}` }),
    el('p', { class: 'small', text: 'Vul in wat er effectief geleverd is. Wat je leeg laat, blijft "nog niet nagekeken".' }),
    el('div', { class: 'row mt-2' }, [
      el('button', { class: 'btn btn--secondary', text: 'Tussentijds bewaren', onclick: () => save(false) }),
      el('button', { class: 'btn', text: 'Levering afsluiten', onclick: () => save(true) }),
      el('a', { class: 'btn btn--ghost', href: `/bestelling?id=${id}`, text: 'Terug naar de bestelling' }),
    ]),
  ]);
}

async function load() {
  data = await api(`/api/counts/${encodeURIComponent(id)}`);
  fields.clear();
  const content = clear(qs('#content'));
  content.append(head());
  if (!data.orders.length) {
    content.append(el('div', { class: 'notice', text: 'Er stond niets op deze bestelling, dus er valt niets na te kijken.' }));
    return;
  }
  for (const group of data.orders) content.append(supplierCard(group));
}

async function init() {
  await mountHeader('');
  if (!id) throw new Error('Geen bestelling gekozen.');
  await load();
}

init().catch((err) => {
  clear(qs('#content'));
  qs('#messages').replaceChildren(el('div', { class: 'notice notice--error' }, [err.message, ' ', el('a', { href: '/historiek', text: 'Terug naar de historiek' })]));
});
