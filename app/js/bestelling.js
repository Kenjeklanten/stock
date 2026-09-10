// Resultaat van een telling: het verschil met de basisstock, klaar om te bestellen.
import { api, toast, fmt, el, clear, qs, params, mountHeader, dateNl, plural } from './app.js';

let data = null;
const id = params().get('id');

/** Ontvangstcontrole: wat er geleverd is, met het verschil tegenover de bestelling. */
const receivedCell = (line) => {
  if (line.received_qty === null || line.received_qty === undefined) return el('span', { class: 'muted', text: '—' });
  const diff = Number(line.received_diff || 0);
  return el('span', {}, [
    `${fmt(line.received_qty)} ${line.unit} `,
    Math.abs(diff) < 0.001
      ? el('span', { class: 'tag tag--mint', text: 'klopt' })
      : el('span', { class: diff < 0 ? 'tag tag--danger' : 'tag tag--sun', text: `${diff > 0 ? '+' : ''}${fmt(diff)}` }),
  ]);
};

const packText = (line) => (Number(line.pack_size) > 1
  ? `${fmt(line.order_packs)} × ${line.pack_label || `${fmt(line.pack_size)} ${line.unit}`}` : '');

/** Getelde stock: totaal, met de splitsing pakken + los erbij als die bekend is. */
const countedText = (line) => {
  if (line.counted_qty === null || line.counted_qty === undefined) return '—';
  const split = line.counted_packs !== null && line.counted_packs !== undefined && Number(line.pack_size) > 1
    ? ` (${fmt(line.counted_packs)} pak + ${fmt(line.counted_loose || 0)})` : '';
  return `${fmt(line.counted_qty)}${split}`;
};

const statusText = (c) => {
  if (c.status === 'geleverd') return `geleverd op ${dateNl((c.received_at || '').slice(0, 10))}`;
  if (c.status === 'besteld') return `besteld op ${dateNl((c.ordered_at || '').slice(0, 10))}`;
  return 'nog niet besteld';
};

function head() {
  const c = data.count;
  const totalUnits = data.orders.reduce((a, g) => a + g.lines.reduce((b, l) => b + Number(l.order_qty), 0), 0);
  const notCounted = data.lines.filter((l) => l.counted_qty === null || l.counted_qty === undefined);

  return el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [
      el('h1', { text: `Bestelling ${c.location_name}` }),
      el('span', { class: c.status === 'open' ? 'tag tag--sun' : 'tag tag--mint', text: statusText(c) }),
    ]),
    el('p', { class: 'muted small', text: `${c.company_name} · telling ${c.id} · ${dateNl(c.counted_on)}${c.created_by ? ` · geteld door ${c.created_by}` : ''}${c.note ? ` · ${c.note}` : ''}` }),
    afwijkingen(),
    el('p', {}, [
      el('b', { text: plural(data.orders.reduce((a, g) => a + g.lines.length, 0), 'bestelregel', 'bestelregels') }),
      ` · ${fmt(totalUnits)} eenheden · ${plural(data.orders.length, 'leverancier', 'leveranciers')}`,
      notCounted.length ? el('span', { class: 'muted', text: ` · ${plural(notCounted.length, 'product', 'producten')} niet geteld` }) : null,
    ]),
    el('div', { class: 'row no-print mt-2' }, [
      el('a', { class: 'btn', href: `/api/counts/${c.id}/pdf`, target: '_blank', rel: 'noopener', text: 'Bestelbon (PDF)' }),
      el('a', { class: 'btn btn--secondary', href: `/api/export/xlsx?count_id=${c.id}`, text: 'Bestellijst (Excel)' }),
      el('a', { class: 'btn btn--ghost', href: `/api/export/xlsx?company_id=${c.company_id}&date=${c.counted_on}`, text: `Bestellijst hele dag (${dateNl(c.counted_on)})` }),
      el('a', { class: 'btn btn--ghost', href: `/api/counts/${c.id}/csv`, text: 'Bestelling (CSV)' }),
      el('a', { class: 'btn btn--ghost', href: `/api/counts/${c.id}/csv?scope=all`, text: 'Volledig telblad (CSV)' }),
      el('a', { class: 'btn btn--ghost', href: `/?count=${c.id}`, text: 'Telling aanpassen' }),
      data.orders.length ? el('a', { class: 'btn btn--secondary', href: `/ontvangst?id=${c.id}`, text: c.received_at ? 'Levering nakijken' : 'Levering inboeken' }) : null,
      el('button', {
        class: c.status === 'besteld' ? 'btn btn--ghost' : 'btn btn--secondary',
        onclick: () => setStatus(c.status === 'besteld' ? 'open' : 'besteld'),
        text: c.status === 'besteld' ? 'Terug op open zetten' : 'Markeer als besteld',
      }),
    ]),
  ]);
}

/** Eén regel met de leveringen die niet klopten — het is de reden waarom je nakijkt. */
function afwijkingen() {
  const lines = data.lines.filter((l) => l.order_qty > 0 && l.received_qty !== null && l.received_qty !== undefined
    && Math.abs(Number(l.received_diff || 0)) >= 0.001);
  if (!lines.length) return null;
  const tekort = lines.filter((l) => Number(l.received_diff) < 0);
  return el('div', { class: 'notice notice--warn mt-2' }, [
    el('b', { text: `${plural(lines.length, 'afwijking', 'afwijkingen')} bij de levering` }),
    ` — ${tekort.length ? `${plural(tekort.length, 'product', 'producten')} te weinig` : 'alles te veel geleverd'}: `,
    lines.map((l) => `${l.product_name} ${Number(l.received_diff) > 0 ? '+' : ''}${fmt(l.received_diff)} ${l.unit}`).join(', '),
  ]);
}

function supplierCard(group) {
  const rows = group.lines.map((l) => el('tr', {}, [
    el('td', {}, [el('b', { text: l.product_name })]),
    el('td', { class: 'num', text: `${fmt(l.base_qty)} ${l.unit}` }),
    el('td', { class: 'num', text: countedText(l) }),
    el('td', { class: 'num', text: fmt(l.shortage) }),
    el('td', { class: 'num' }, [el('b', { text: `${fmt(l.order_qty)} ${l.unit}` })]),
    el('td', { text: packText(l) }),
    el('td', { class: 'num' }, [receivedCell(l)]),
  ]));

  const units = group.lines.reduce((a, l) => a + Number(l.order_qty), 0);
  return el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [
      el('h2', { text: group.supplier_name }),
      el('span', { class: 'spacer' }),
      el('a', { class: 'btn btn--sm btn--ghost no-print', href: `/api/counts/${data.count.id}/pdf?supplier=${group.supplier_id ?? 0}`, target: '_blank', rel: 'noopener', text: 'PDF' }),
      el('a', { class: 'btn btn--sm btn--ghost no-print', href: `/api/counts/${data.count.id}/csv?supplier=${group.supplier_id ?? 0}`, text: 'CSV' }),
    ]),
    el('div', { class: 'table-wrap' }, [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Product' }),
          el('th', { class: 'num', text: 'Basis' }), el('th', { class: 'num', text: 'Geteld' }),
          el('th', { class: 'num', text: 'Tekort' }), el('th', { class: 'num', text: 'Bestellen' }),
          el('th', { text: 'Verpakking' }), el('th', { class: 'num', text: 'Geleverd' }),
        ])]),
        el('tbody', {}, rows),
      ]),
    ]),
    el('p', { class: 'small muted', text: `${plural(group.lines.length, 'regel', 'regels')} · ${fmt(units)} eenheden` }),
  ]);
}

function extras() {
  const enough = data.lines.filter((l) => (l.counted_qty !== null && l.counted_qty !== undefined) && !(l.order_qty > 0));
  const missing = data.lines.filter((l) => l.counted_qty === null || l.counted_qty === undefined);
  const box = el('section', { class: 'card no-print' }, [el('h2', { text: 'Rest van de telling' })]);

  const list = (title, items, note) => {
    if (!items.length) return null;
    const details = el('details', { class: 'mt-1' }, [
      el('summary', { text: `${title} (${items.length})` }),
      el('p', { class: 'muted small', text: note }),
      el('ul', { class: 'small' }, items.map((l) => el('li', {
        text: `${l.product_name} — basis ${fmt(l.base_qty)} ${l.unit}${l.counted_qty === null || l.counted_qty === undefined ? '' : `, geteld ${countedText(l)}`}`,
      }))),
    ]);
    return details;
  };
  for (const details of [
    list('Voldoende op voorraad', enough, 'Deze producten staan op of boven de basisstock en komen niet op de bestelling.'),
    list('Niet geteld', missing, 'Er is geen aantal ingevuld, dus deze producten worden niet besteld.'),
  ]) if (details) box.append(details);
  return enough.length || missing.length ? box : null;
}

async function setStatus(status) {
  try {
    await api(`/api/counts/${id}`, { method: 'PATCH', body: { status } });
    toast(status === 'besteld' ? 'Gemarkeerd als besteld.' : 'Terug op open gezet.');
    await load();
  } catch (err) { toast(err.message, true); }
}

async function load() {
  data = await api(`/api/counts/${encodeURIComponent(id)}`);
  const content = clear(qs('#content'));
  content.append(head());
  if (!data.orders.length) {
    content.append(el('div', { class: 'notice notice--ok', text: 'Alles staat op basisstock — er hoeft niets besteld te worden.' }));
  }
  for (const group of data.orders) content.append(supplierCard(group));
  const rest = extras();
  if (rest) content.append(rest);
}

async function init() {
  await mountHeader('');
  if (!id) throw new Error('Geen telling gekozen.');
  await load();
}

init().catch((err) => {
  clear(qs('#content'));
  qs('#messages').replaceChildren(el('div', { class: 'notice notice--error' }, [err.message, ' ', el('a', { href: '/historiek', text: 'Terug naar de historiek' })]));
});
