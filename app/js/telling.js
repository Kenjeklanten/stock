// Telformulier: per product tel je de volle pakken en de losse stuks. Het verschil met de
// basisstock uit de database wordt de bestelling.
import { api, toast, fmt, num, today, el, clear, qs, draft, params, mountHeader, dateNl,
  OfflineError, wachtrij, toonVerbinding } from './app.js';

const state = {
  companyId: null, locationId: null, countId: null, countedOn: null,
  products: [], values: new Map(),
  onlyTodo: false, filter: '',
};

const filled = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = num(v, null);
  return n !== null && n >= 0 ? n : null;
};

/** Getelde stock uit volle pakken + losse stuks; null = niet geteld. */
function countedTotal(packs, loose, packSize) {
  const p = filled(packs), l = filled(loose);
  if (p === null && l === null) return null;
  const pack = Number(packSize) > 0 ? Number(packSize) : 1;
  return Math.round(((p || 0) * pack + (l || 0)) * 100) / 100;
}

const orderQty = (base, counted, pack) => {
  if (counted === null) return 0;
  const need = Math.max(0, Math.round((base - counted) * 100) / 100);
  if (need <= 0) return 0;
  const p = Number(pack) > 0 ? Number(pack) : 1;
  return Math.round(Math.ceil(need / p - 1e-9) * p * 100) / 100;
};

const valueOf = (id) => state.values.get(id) || { packs: '', loose: '' };
const totalOf = (p) => { const v = valueOf(p.id); return countedTotal(v.packs, v.loose, p.pack_size); };
const packName = (p) => p.pack_label || `${fmt(p.pack_size)} ${p.unit}`;

/** De producten staan per leverancier, in de volgorde van het beheerscherm. */
function groupsOf(products) {
  const map = new Map();
  for (const p of products) {
    const k = p.supplier_name || 'Zonder leverancier';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  }
  return [...map.entries()];
}

function resultText(p) {
  const total = totalOf(p);
  if (total === null) return { text: '', ok: false };
  const order = orderQty(p.base_qty, total, p.pack_size);
  if (order <= 0) return { text: `geteld ${fmt(total)} ${p.unit} · voldoende op voorraad`, ok: true };
  const packs = Number(p.pack_size) > 1 ? ` (${fmt(order / p.pack_size)} × ${packName(p)})` : '';
  return { text: `geteld ${fmt(total)} ${p.unit} · bestellen ${fmt(order)} ${p.unit}${packs}`, ok: false };
}

function refreshRow(row, p) {
  const total = totalOf(p);
  const order = orderQty(p.base_qty, total, p.pack_size);
  row.classList.toggle('item--order', order > 0);
  row.classList.toggle('item--counted', total !== null && order === 0);
  const result = row.querySelector('.item__result');
  const { text, ok } = resultText(p);
  result.textContent = text;
  result.classList.toggle('item__result--ok', ok);
}

/**
 * Eén telveld met een min- en een plusknop ernaast. Aan de toog wordt met natte handen op een
 * telefoon geteld: tikken op een knop gaat vlotter (en misgaat minder) dan een cijfer typen.
 */
function countField(label, p, key, row) {
  const input = el('input', {
    type: 'number', min: '0', step: 'any', inputmode: 'decimal',
    value: valueOf(p.id)[key], placeholder: '—',
    'aria-label': `${label} ${p.name}`,
  });

  const bewaar = () => {
    const current = { ...valueOf(p.id), [key]: input.value };
    if (current.packs === '' && current.loose === '') state.values.delete(p.id);
    else state.values.set(p.id, current);
    saveDraft();
    refreshRow(row, p);
    updateStats();
  };
  input.addEventListener('input', bewaar);

  const stap = (richting) => {
    const nu = num(input.value, null);
    const volgende = Math.max(0, (nu === null ? 0 : nu) + richting);
    // van leeg naar 0 gaan met de minknop heeft geen zin, maar wél iets zeggen: 0 is geteld
    input.value = String(Math.round(volgende * 100) / 100);
    bewaar();
  };
  const knop = (teken, richting, naam) => {
    const b = el('button', { type: 'button', class: 'step', text: teken, 'aria-label': `${naam} ${label} ${p.name}` });
    b.addEventListener('click', () => stap(richting));
    return b;
  };

  return el('div', { class: 'count-field' }, [
    el('label', {}, [
      el('span', { text: label }),
      el('div', { class: 'count-field__row' }, [knop('−', -1, 'Eén minder'), input, knop('+', 1, 'Eén meer')]),
    ]),
  ]);
}

function itemRow(p) {
  const row = el('div', { class: 'item', dataset: { id: String(p.id) } });
  const hasPacks = Number(p.pack_size) > 1;
  row.append(
    el('div', {}, [
      el('div', { class: 'item__name', text: p.name }),
      el('div', { class: 'item__meta' }, [
        el('span', { class: 'tag tag--grape', text: `basis ${fmt(p.base_qty)} ${p.unit}` }),
        hasPacks ? el('span', { text: `1 pak = ${fmt(p.pack_size)} ${p.unit}` }) : null,
      ]),
    ]),
    el('div', { class: 'count-fields' }, hasPacks
      ? [countField('volle pakken', p, 'packs', row), countField(`losse ${p.unit}`, p, 'loose', row)]
      : [countField(`aantal ${p.unit}`, p, 'loose', row)]),
    el('div', { class: 'item__result' }),
  );
  refreshRow(row, p);
  return row;
}

function render() {
  const list = clear(qs('#list'));
  const term = state.filter.trim().toLowerCase();
  let visible = state.products;
  if (term) visible = visible.filter((p) => `${p.name} ${p.supplier_name || ''}`.toLowerCase().includes(term));
  if (state.onlyTodo) visible = visible.filter((p) => totalOf(p) === null);

  if (!visible.length) {
    list.append(el('p', { class: 'skeleton', text: state.products.length
      ? 'Geen producten gevonden met deze filter.'
      : 'Deze locatie heeft nog geen producten met een basisstock. Vul die in bij Beheer.' }));
    return;
  }
  for (const [title, items] of groupsOf(visible)) {
    const group = el('section', { class: 'count-group' }, [el('h3', { text: `${title} · ${items.length}` })]);
    for (const p of items) group.append(itemRow(p));
    list.append(group);
  }
}

function updateStats() {
  const counted = state.products.filter((p) => totalOf(p) !== null).length;
  const orders = state.products.filter((p) => orderQty(p.base_qty, totalOf(p), p.pack_size) > 0).length;
  qs('#stat-counted').textContent = String(counted);
  qs('#stat-total').textContent = String(state.products.length);
  qs('#stat-order').textContent = String(orders);
  qs('#bar').hidden = !state.products.length;
}

// De telling is altijd van vandaag; bij het aanpassen van een oudere telling blijft haar datum staan.
const dayOf = () => state.countedOn || today();

const saveDraft = () => {
  if (!state.locationId || state.countId) return;
  draft.save(state.locationId, dayOf(), [...state.values.entries()]);
};

async function loadLocation(locationId, { keepValues = false } = {}) {
  state.locationId = locationId;
  if (!locationId) {
    state.products = [];
    render(); updateStats();
    qs('#controls').hidden = true;
    return;
  }
  qs('#list').replaceChildren(el('p', { class: 'skeleton', text: 'Producten laden…' }));
  const data = await api(`/api/catalog?company_id=${state.companyId}&location_id=${encodeURIComponent(locationId)}`);
  state.products = data.products || [];
  qs('#controls').hidden = !state.products.length;

  if (!keepValues) {
    state.values = new Map();
    const saved = draft.load(locationId, dayOf());
    if (saved && Array.isArray(saved.values) && saved.values.length) {
      state.values = new Map(saved.values.filter(([id]) => state.products.some((p) => p.id === id)));
      if (state.values.size) toast(`Klad hersteld: ${state.values.size} ingevulde producten.`);
    }
  }
  if (data.last_count) {
    qs('#messages').replaceChildren(el('div', { class: 'notice' }, [
      `Laatste telling voor deze locatie: ${dateNl(data.last_count.counted_on)}`,
      data.last_count.status === 'besteld' ? ' (besteld). ' : '. ',
      el('a', { href: `/bestelling?id=${data.last_count.id}`, text: 'Bekijk die bestelling' }),
    ]));
  } else {
    clear(qs('#messages'));
  }
  render();
  updateStats();
}

async function loadExisting(countId) {
  const data = await api(`/api/counts/${countId}`);
  state.countId = countId;
  state.companyId = data.count.company_id;
  state.countedOn = data.count.counted_on;
  qs('#page-title').textContent = `Telling ${countId} aanpassen`;
  qs('#page-intro').textContent = `Telling van ${dateNl(data.count.counted_on)}${data.count.created_by ? ` door ${data.count.created_by}` : ''}. Pas de getelde aantallen aan en bewaar; de bestelling wordt opnieuw berekend.`;
  qs('#btn-save').textContent = 'Bewaren';
  qs('#note').value = data.count.note || '';
  await fillLocations();
  qs('#location').value = String(data.count.location_id);
  qs('#location').disabled = true;
  await loadLocation(data.count.location_id, { keepValues: true });

  state.values = new Map(data.lines
    .filter((l) => l.counted_qty !== null && l.counted_qty !== undefined)
    .map((l) => {
      if (l.counted_packs !== null && l.counted_packs !== undefined) {
        return [l.product_id, { packs: fmt(l.counted_packs), loose: fmt(l.counted_loose || 0) }];
      }
      const pack = Number(l.pack_size) > 1 ? Number(l.pack_size) : 1;
      const packs = Math.floor(l.counted_qty / pack);
      return [l.product_id, { packs: pack > 1 ? fmt(packs) : '', loose: fmt(l.counted_qty - (pack > 1 ? packs * pack : 0)) }];
    }));
  render();
  updateStats();
}

async function save() {
  if (!state.locationId) return toast('Kies eerst een locatie.', true);
  if (!state.values.size) return toast('Vul minstens één getelde stock in.', true);
  const missing = state.products.filter((p) => totalOf(p) === null).length;
  if (missing > 0 && !confirm(`${missing} product(en) heb je niet geteld. Die komen niet op de bestelling. Toch doorgaan?`)) return;

  const button = qs('#btn-save');
  button.disabled = true;
  const payload = {
    location_id: state.locationId,
    counted_on: dayOf(),
    note: qs('#note').value,
    lines: state.products.map((p) => {
      const v = valueOf(p.id);
      return { product_id: p.id, packs: v.packs === '' ? null : num(v.packs, null), loose: v.loose === '' ? null : num(v.loose, null) };
    }),
  };
  try {
    const result = state.countId
      ? await api(`/api/counts/${state.countId}`, { method: 'PUT', body: payload })
      : await api('/api/counts', { method: 'POST', body: payload });
    draft.clear(state.locationId, payload.counted_on);
    location.href = `/bestelling?id=${state.countId || result.id}`;
  } catch (err) {
    // Geen bereik? De telling gaat niet verloren: ze blijft op dit toestel staan en vertrekt
    // vanzelf zodra er weer verbinding is.
    if (err instanceof OfflineError) {
      const wachtend = wachtrij.add({ count_id: state.countId, payload });
      draft.clear(state.locationId, payload.counted_on);
      toonVerbinding();
      qs('#messages').replaceChildren(el('div', { class: 'notice notice--warn' }, [
        el('b', { text: 'Geen verbinding — de telling staat op dit toestel bewaard. ' }),
        `Ze wordt vanzelf verstuurd zodra je weer bereik hebt (${wachtend} in de wachtrij). `,
        'Sluit de app niet af voor ze weg is.',
      ]));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      toast(err.message, true);
    }
    button.disabled = false;
  }
}

async function fillLocations() {
  const data = await api(`/api/catalog?company_id=${state.companyId}`);
  const select = clear(qs('#location'));
  const active = (data.locations || []).filter((l) => l.active);
  select.append(el('option', { value: '', text: active.length ? 'Kies een locatie…' : 'Nog geen locaties — voeg ze toe bij Beheer' }));
  for (const l of active) select.append(el('option', { value: String(l.id), text: l.name }));
  return active;
}

async function init() {
  const header = await mountHeader('telling');
  state.companyId = header.companyId;
  qs('#today').textContent = dateNl(today());

  const editId = params().get('count');
  if (editId) return loadExisting(num(editId, null));

  if (!state.companyId) {
    qs('#messages').replaceChildren(el('div', { class: 'notice' }, [
      'Er is nog geen bedrijf ingesteld. ',
      el('a', { href: '/beheer', text: 'Maak er eerst één aan bij Beheer' }), '.',
    ]));
    qs('#list').replaceChildren();
    return;
  }

  const active = await fillLocations();
  const select = qs('#location');
  select.addEventListener('change', () => loadLocation(num(select.value, null)).catch((e) => toast(e.message, true)));
  qs('#search').addEventListener('input', (e) => { state.filter = e.target.value; render(); });
  qs('#toggle-todo').addEventListener('click', (e) => {
    state.onlyTodo = !state.onlyTodo;
    e.target.textContent = state.onlyTodo ? 'Alle producten tonen' : 'Enkel niet-getelde tonen';
    render();
  });
  qs('#btn-reset').addEventListener('click', () => {
    if (!state.values.size || !confirm('Alle ingevulde aantallen wissen?')) return;
    state.values.clear();
    saveDraft();
    render();
    updateStats();
  });
  qs('#btn-save').addEventListener('click', save);
  qs('#count-form').addEventListener('submit', (e) => { e.preventDefault(); save(); });

  const preset = params().get('location');
  if (preset && active.some((l) => String(l.id) === preset)) {
    select.value = preset;
    await loadLocation(num(preset, null));
  } else if (active.length === 1) {
    select.value = String(active[0].id);
    await loadLocation(active[0].id);
  }
}

init().catch((err) => {
  qs('#messages').replaceChildren(el('div', { class: 'notice notice--error', text: err.message }));
});
