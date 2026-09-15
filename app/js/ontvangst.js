// Ontvangstcontrole: is er geleverd wat er besteld was? Per product wordt geteld zoals bij de
// stocktelling — volle pakken + losse stuks — en het verschil met de bestelling staat ernaast.
//
// In de praktijk klopt het meeste. Daarom kan je per leverancier in één klik invullen dat alles
// geleverd is zoals besteld; wat je zelf al ingevuld hebt blijft staan, zodat je enkel de
// uitzonderingen hoeft aan te raken.
import { api, toast, fmt, num, el, clear, qs, params, mountHeader, dateNl, plural } from './app.js';

let data = null;
const id = params().get('id');
const fields = new Map();   // product_id → { packs, loose, diff }
let samenvattingCel = null;

const packOf = (line) => (Number(line.pack_size) > 0 ? Number(line.pack_size) : 1);
const total = (line) => (num(fields.get(line.product_id).packs.value, 0) || 0) * packOf(line)
  + (num(fields.get(line.product_id).loose.value, 0) || 0);

/** Ingevuld? Een lege regel blijft "nog niet nagekeken". */
const touched = (line) => {
  const f = fields.get(line.product_id);
  return f.packs.value.trim() !== '' || f.loose.value.trim() !== '';
};

/** Alle bestelregels, over alle leveranciers heen. */
const alleRegels = () => data.orders.flatMap((g) => g.lines);

/** Klopt deze regel met wat er besteld was? */
const scheef = (line) => Math.abs(total(line) - Number(line.order_qty)) >= 0.001;

function showDiff(line) {
  const cell = fields.get(line.product_id).diff;
  clear(cell);
  if (!touched(line)) return cell.append(el('span', { class: 'muted', text: '—' }));
  if (!scheef(line)) return cell.append(el('span', { class: 'tag tag--mint', text: 'klopt' }));
  const diff = total(line) - Number(line.order_qty);
  cell.append(el('span', {
    class: diff < 0 ? 'tag tag--danger' : 'tag tag--sun',
    text: `${diff > 0 ? '+' : ''}${fmt(diff)} ${line.unit}`,
  }));
}

/** Hoeveel is er al nagekeken, en hoeveel daarvan klopte niet? */
function ververs() {
  for (const group of data.orders) {
    if (group.knop) {
      group.knop.textContent = group.lines.some(touched) ? 'Rest zoals besteld' : 'Alles zoals besteld';
    }
  }
  if (!samenvattingCel) return;
  const regels = alleRegels();
  const gedaan = regels.filter(touched);
  const fout = gedaan.filter(scheef);
  clear(samenvattingCel);
  samenvattingCel.append(el('b', { text: `${gedaan.length} van ${plural(regels.length, 'regel', 'regels')} nagekeken` }));
  if (fout.length) {
    samenvattingCel.append(' · ', el('span', { class: 'tag tag--danger', text: plural(fout.length, 'afwijking', 'afwijkingen') }));
  } else if (gedaan.length) {
    samenvattingCel.append(el('span', { class: 'muted', text: ' · alles klopt tot hiertoe' }));
  }
}

/** Vult de bestelde hoeveelheid in bij de regels die nog leeg staan. */
function zoalsBesteld(lines) {
  let ingevuld = 0;
  for (const line of lines) {
    if (touched(line)) continue;
    const f = fields.get(line.product_id);
    const pack = packOf(line);
    const packs = pack > 1 ? Math.floor(Number(line.order_qty) / pack) : 0;
    f.packs.value = String(packs);
    f.loose.value = String(Number(line.order_qty) - packs * pack);
    showDiff(line);
    ingevuld += 1;
  }
  ververs();
  if (!ingevuld) toast('Alle regels van deze leverancier waren al ingevuld.');
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
  for (const input of [packs, loose]) {
    input.addEventListener('input', () => { showDiff(line); ververs(); });
  }

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
  const body = el('div', { class: 'table-wrap' }, [el('table', {}, [
    el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Product' }), el('th', { class: 'num', text: 'Besteld' }),
      el('th', { text: 'Volle pakken' }), el('th', { text: 'Losse stuks' }),
      el('th', { class: 'num', text: 'Verschil' }),
    ])]),
    el('tbody', {}, group.lines.map(row)),
  ])]);

  group.knop = el('button', {
    class: 'btn btn--sm btn--secondary',
    text: 'Alles zoals besteld',
    onclick: () => zoalsBesteld(group.lines),
  });

  return el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [
      el('h2', { text: group.supplier_name }),
      el('span', { class: 'spacer' }),
      group.knop,
    ]),
    body,
  ]);
}

const payload = () => [...fields.entries()].map(([product_id, f]) => ({
  product_id,
  packs: f.packs.value.trim() === '' ? null : f.packs.value,
  loose: f.loose.value.trim() === '' ? null : f.loose.value,
}));

async function save(complete) {
  if (complete) {
    const open = alleRegels().filter((l) => !touched(l)).length;
    const vraag = `${plural(open, 'regel is', 'regels zijn')} nog niet ingevuld. Toch afsluiten?`
      + '\n\nWat niet ingevuld is, blijft "nog niet nagekeken" en telt niet mee als geleverde stock.';
    if (open && !confirm(vraag)) return;
  }
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
  return el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [
      el('h1', { text: `Levering inboeken — ${c.location_name}` }),
      c.received_at ? el('span', { class: 'tag tag--mint', text: `nagekeken op ${dateNl(c.received_at.slice(0, 10))}` }) : null,
    ]),
    el('p', { class: 'muted small', text: `${c.company_name} · telling ${c.id} van ${dateNl(c.counted_on)}` }),
    el('p', { class: 'small', text: 'Vul in wat er effectief geleverd is. Wat je leeg laat, blijft "nog niet nagekeken".' }),
    samenvattingCel,
    el('div', { class: 'row mt-2' }, [
      el('button', { class: 'btn btn--secondary', text: 'Tussentijds bewaren', onclick: () => save(false) }),
      el('button', { class: 'btn', text: 'Levering afsluiten', onclick: () => save(true) }),
      el('a', { class: 'btn btn--ghost', href: `/bestelling?id=${id}`, text: 'Naar de bestelling' }),
      el('a', { class: 'btn btn--ghost', href: '/leveringen', text: 'Alle leveringen' }),
    ]),
  ]);
}

async function load() {
  data = await api(`/api/counts/${encodeURIComponent(id)}`);
  fields.clear();
  samenvattingCel = el('p', { class: 'mt-1' });
  const content = clear(qs('#content'));
  content.append(head());
  if (!data.orders.length) {
    samenvattingCel = null;
    content.append(el('div', { class: 'notice', text: 'Er stond niets op deze bestelling, dus er valt niets na te kijken.' }));
    return;
  }
  for (const group of data.orders) content.append(supplierCard(group));
  ververs();
}

async function init() {
  await mountHeader('leveringen');
  if (!id) throw new Error('Geen bestelling gekozen.');
  await load();
}

init().catch((err) => {
  clear(qs('#content'));
  qs('#messages').replaceChildren(el('div', { class: 'notice notice--error' }, [err.message, ' ', el('a', { href: '/leveringen', text: 'Terug naar de leveringen' })]));
});
