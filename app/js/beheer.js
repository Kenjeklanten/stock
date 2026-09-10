// Beheerscherm. Alles hangt aan het bedrijf dat bovenaan gekozen is: producten met hun
// basisstock per locatie, locaties, leveranciers, import/export en de bedrijfsgegevens zelf.
import { api, toast, fmt, num, el, clear, qs, qsa, mountHeader, plural } from './app.js';

const state = {
  companyId: null, company: null, locations: [], suppliers: [], products: [], companies: [],
  codes: [], reasons: [], settings: {}, tab: 'producten', canManage: true, superAdmin: true,
};

const input = (props) => el('input', { type: 'text', ...props });

async function refresh() {
  const data = await api(`/api/catalog${state.companyId ? `?company_id=${state.companyId}&all=1` : ''}`);
  state.companies = data.companies || [];
  state.company = data.company || null;
  state.locations = data.locations || [];
  state.reasons = data.reasons || [];
  state.suppliers = data.suppliers || [];
  state.products = data.products || [];
  state.settings = data.settings || {};
}

/* ---------------- producten ---------------- */

function productRow(p, activeLocations) {
  const values = {
    id: p.id, company_id: state.companyId, name: p.name,
    unit: p.unit || 'stuk', pack_size: p.pack_size, pack_label: p.pack_label || '',
    supplier_id: p.supplier_id || '', active: p.active !== 0, base: { ...(p.base || {}) },
  };
  const tr = el('tr', { dataset: { id: String(p.id) } });
  const save = el('button', { class: 'btn btn--sm', disabled: true, text: 'Bewaar' });
  const bind = (node, key) => {
    node.addEventListener('input', () => { values[key] = node.value; save.disabled = false; });
    return node;
  };

  tr.append(
    el('td', {}, [bind(input({ value: values.name, 'aria-label': 'Productnaam' }), 'name')]),
    el('td', { class: 'cell-narrow' }, [(() => {
      const sel = el('select', { 'aria-label': 'Leverancier' }, [el('option', { value: '', text: '—' })]);
      for (const s of state.suppliers) sel.append(el('option', { value: String(s.id), text: s.name }));
      sel.value = values.supplier_id ? String(values.supplier_id) : '';
      sel.addEventListener('change', () => { values.supplier_id = sel.value; save.disabled = false; });
      return sel;
    })()]),
    el('td', { class: 'cell-tiny' }, [bind(input({ value: values.unit, 'aria-label': 'Eenheid' }), 'unit')]),
    el('td', { class: 'cell-tiny' }, [bind(el('input', { type: 'number', min: '0.01', step: 'any', value: String(values.pack_size), 'aria-label': 'Aantal per volle verpakking' }), 'pack_size')]),
    el('td', { class: 'cell-narrow' }, [bind(input({ value: values.pack_label, placeholder: 'bv. bak van 24', 'aria-label': 'Naam van de verpakking' }), 'pack_label')]),
  );

  for (const loc of activeLocations) {
    const current = values.base[loc.id];
    const box = el('input', {
      type: 'number', min: '0', step: 'any', class: 'num',
      value: current === undefined ? '' : fmt(current),
      placeholder: '—', 'aria-label': `Basisstock ${p.name} in ${loc.name}`,
    });
    box.addEventListener('input', () => { values.base[loc.id] = box.value === '' ? '' : num(box.value, 0); save.disabled = false; });
    tr.append(el('td', { class: 'cell-tiny' }, [box]));
  }

  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await api('/api/admin/products', { method: 'PUT', body: { ...values, pack_size: num(values.pack_size, 1) } });
      toast(`"${values.name}" bewaard.`);
    } catch (err) { toast(err.message, true); save.disabled = false; }
  });

  const del = el('button', { class: 'btn btn--sm btn--danger', text: 'Wis' });
  del.addEventListener('click', async () => {
    if (!confirm(`"${p.name}" verwijderen?`)) return;
    try {
      const res = await api(`/api/admin/products?id=${p.id}`, { method: 'DELETE' });
      toast(res.message || 'Product verwijderd.');
      await refresh(); renderTab();
    } catch (err) { toast(err.message, true); }
  });

  tr.append(el('td', {}, [el('div', { class: 'row' }, [save, del])]));
  return tr;
}

function newProductForm(activeLocations) {
  const fields = {};
  const field = (label, node, cls = 'f-field') => el('div', { class: cls }, [el('label', { text: label }), node]);
  fields.name = input({ placeholder: 'Productnaam' });
  fields.unit = input({ value: 'stuk' });
  fields.pack_size = el('input', { type: 'number', min: '0.01', step: 'any', value: '1' });
  fields.pack_label = input({ placeholder: 'bv. bak van 24' });
  fields.supplier = el('select', {}, [el('option', { value: '', text: '—' }), ...state.suppliers.map((s) => el('option', { value: String(s.id), text: s.name }))]);
  const baseInputs = new Map();
  for (const loc of activeLocations) baseInputs.set(loc.id, el('input', { type: 'number', min: '0', step: 'any', placeholder: '—' }));

  const submit = el('button', { class: 'btn', text: 'Product toevoegen' });
  submit.addEventListener('click', async () => {
    const body = {
      company_id: state.companyId,
      name: fields.name.value,
      unit: fields.unit.value, pack_size: num(fields.pack_size.value, 1), pack_label: fields.pack_label.value,
      supplier_id: fields.supplier.value || null,
      base: Object.fromEntries([...baseInputs.entries()].map(([id, box]) => [id, box.value === '' ? '' : num(box.value, 0)])),
    };
    if (!body.name.trim()) return toast('Geef het product een naam.', true);
    try {
      await api('/api/admin/products', { method: 'POST', body });
      toast('Product toegevoegd.');
      await refresh(); renderTab();
    } catch (err) { toast(err.message, true); }
  });

  return el('details', { class: 'card', open: state.products.length === 0 }, [
    el('summary', {}, [el('b', { text: 'Nieuw product toevoegen' })]),
    el('div', { class: 'row mt-2 align-end' }, [
      field('Naam', fields.name, 'f-field-wide'), field('Leverancier', fields.supplier), field('Eenheid', fields.unit), field('Per volle verpakking', fields.pack_size),
      field('Naam verpakking', fields.pack_label),
      ...activeLocations.map((loc) => field(`Basis ${loc.name}`, baseInputs.get(loc.id))),
      el('div', { class: 'f-fixed' }, [submit]),
    ]),
  ]);
}

function renderProducts(panel) {
  const activeLocations = state.locations.filter((l) => l.active);
  panel.append(newProductForm(activeLocations));
  if (!activeLocations.length) {
    panel.append(el('div', { class: 'notice', text: 'Maak eerst een locatie aan; daarna kan je per locatie een basisstock invullen.' }));
  }

  const search = el('input', { type: 'search', placeholder: 'zoek een product of leverancier' });
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [
      el('h2', { text: `Producten van ${state.company ? state.company.name : '—'} (${state.products.length})` }),
      el('span', { class: 'spacer' }),
      el('div', { class: 'f-16' }, [search]),
    ]),
  ]);

  const tbody = el('tbody', {});
  const table = el('div', { class: 'table-wrap' }, [el('table', { class: 'table--edit' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', { class: 'cell-move', text: '', title: 'Volgorde' }),
      el('th', { text: 'Product' }), el('th', { text: 'Leverancier' }), el('th', { text: 'Eenheid' }), el('th', { text: 'Per verp.' }), el('th', { text: 'Verpakking' }),
      ...activeLocations.map((l) => el('th', { class: 'num', text: `Basis ${l.name}` })),
      el('th', { text: '' }),
    ])]),
    tbody,
  ])]);

  const fill = (term = '') => {
    clear(tbody);
    const list = state.products.filter((p) => !term || `${p.name} ${p.supplier_name || ''}`.toLowerCase().includes(term));
    if (!list.length) tbody.append(el('tr', {}, [el('td', { colspan: String(7 + activeLocations.length), class: 'muted', text: 'Geen producten gevonden.' })]));
    for (const p of list) {
      const rij = productRow(p, activeLocations);
      rij.prepend(volgordeCel(rij, tbody, 'products'));
      tbody.append(rij);
    }
    maakSleepbaar(tbody, 'products');
  };
  fill();
  search.addEventListener('input', () => fill(search.value.trim().toLowerCase()));

  card.append(table, el('p', { class: 'small muted mt-1', text: 'Een lege basisstock betekent: dit product hoort niet in die locatie en verschijnt daar niet op het telformulier.' }));
  panel.append(card);
}

/* ---------------- volgorde: slepen of met de pijltjes ---------------- */

/**
 * De volgorde van een lijst wordt niet meer met een cijferkolom ingevuld maar met de rijen zelf:
 * slepen met de muis, of de pijltjes voor wie liever tikt of het toetsenbord gebruikt.
 */
function volgordeCel(tr, tbody, tabel) {
  const verzet = (richting) => {
    const buur = richting < 0 ? tr.previousElementSibling : tr.nextElementSibling;
    if (!buur || !buur.dataset.id) return;
    tbody.insertBefore(richting < 0 ? tr : buur, richting < 0 ? buur : tr);
    bewaarVolgorde(tbody, tabel);
  };
  const pijl = (teken, richting, naam) => {
    const b = el('button', { type: 'button', class: 'move', text: teken, title: naam, 'aria-label': naam });
    b.addEventListener('click', () => verzet(richting));
    return b;
  };
  return el('td', { class: 'cell-move' }, [
    el('span', { class: 'grip', title: 'Sleep om te herschikken', 'aria-hidden': 'true', text: '⠿' }),
    pijl('↑', -1, 'Naar boven'),
    pijl('↓', 1, 'Naar onder'),
  ]);
}

async function bewaarVolgorde(tbody, tabel) {
  const ids = [...tbody.children].map((tr) => Number(tr.dataset.id)).filter(Boolean);
  if (!ids.length) return;
  try {
    await api('/api/admin/sort', { method: 'POST', body: { table: tabel, ids } });
    // de lijst in het geheugen mee bijwerken, zodat andere tabs dezelfde volgorde tonen
    await refresh();
  } catch (err) { toast(err.message, true); }
}

/** Rijen slepen. Werkt met de muis; op een tablet gebruik je de pijltjes. */
function maakSleepbaar(tbody, tabel) {
  let bron = null;
  for (const tr of [...tbody.children]) {
    if (!tr.dataset.id) continue;
    tr.draggable = true;
    tr.addEventListener('dragstart', (e) => {
      bron = tr;
      tr.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tr.dataset.id);
    });
    tr.addEventListener('dragend', () => {
      tr.classList.remove('dragging');
      bron = null;
      bewaarVolgorde(tbody, tabel);
    });
    tr.addEventListener('dragover', (e) => {
      if (!bron || bron === tr) return;
      e.preventDefault();
      const vak = tr.getBoundingClientRect();
      const onderhelft = e.clientY > vak.top + vak.height / 2;
      tbody.insertBefore(bron, onderhelft ? tr.nextSibling : tr);
    });
  }
}

/* ---------------- eenvoudige tabellen ---------------- */

function crudTable({ title, endpoint, table, items, columns, newLabel, withCompany = true, withActive = true }) {
  // Bij bedrijven verandert ook de keuzelijst bovenaan: het scherm wordt opnieuw opgebouwd.
  const reloadAfter = endpoint.endsWith('/companies');
  const tbody = el('tbody', {});
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [el('h2', { text: `${title} (${items.length})` })]),
    el('div', { class: 'table-wrap' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        table ? el('th', { class: 'cell-move', text: '', title: 'Volgorde' }) : null,
        ...columns.map((c) => el('th', { text: c.label })),
        withActive ? el('th', { text: 'Actief' }) : null, el('th', { text: '' }),
      ])]),
      tbody,
    ])]),
  ]);

  for (const item of items) {
    const values = { ...item, active: item.active !== 0 };
    const save = el('button', { class: 'btn btn--sm', disabled: true, text: 'Bewaar' });
    const tr = el('tr', { dataset: { id: String(item.id) } }, columns.map((c) => {
      const huidig = values[c.k] === null || values[c.k] === undefined ? '' : String(values[c.k]);
      const node = c.keuzes
        ? el('select', { 'aria-label': `${c.label} ${item.name}` }, c.keuzes.map((k) => el('option', { value: k, text: k })))
        : el('input', { type: c.type || 'text', value: huidig, 'aria-label': `${c.label} ${item.name}` });
      if (c.keuzes) { node.value = huidig || c.keuzes[0]; node.addEventListener('change', () => { values[c.k] = node.value; save.disabled = false; }); }
      node.addEventListener('input', () => { values[c.k] = node.value; save.disabled = false; });
      return el('td', { class: c.narrow ? 'cell-narrow' : '' }, [node]);
    }));
    if (table) tr.prepend(volgordeCel(tr, tbody, table));
    if (withActive) {
      const active = el('input', { type: 'checkbox', checked: values.active, class: 'check', 'aria-label': `Actief ${item.name}` });
      active.addEventListener('change', () => { values.active = active.checked; save.disabled = false; });
      tr.append(el('td', {}, [active]));
    }

    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await api(endpoint, { method: 'PUT', body: values });
        toast('Bewaard.');
        if (reloadAfter) return location.reload();
        await refresh();
      } catch (err) { toast(err.message, true); save.disabled = false; }
    });
    const del = el('button', { class: 'btn btn--sm btn--danger', text: 'Wis' });
    del.addEventListener('click', async () => {
      if (!confirm(`"${item.name}" verwijderen?`)) return;
      try {
        const res = await api(`${endpoint}?id=${item.id}`, { method: 'DELETE' });
        toast(res.message || 'Verwijderd.');
        if (reloadAfter) return location.reload();
        await refresh(); renderTab();
      } catch (err) { toast(err.message, true); }
    });
    tr.append(el('td', {}, [el('div', { class: 'row' }, [save, del])]));
    tbody.append(tr);
  }
  if (!items.length) tbody.append(el('tr', {}, [el('td', { colspan: String(columns.length + (withActive ? 2 : 1) + (table ? 1 : 0)), class: 'muted', text: 'Nog niets toegevoegd.' })]));
  if (table) maakSleepbaar(tbody, table);

  const fields = columns.map((c) => ({
    c,
    node: c.keuzes
      ? el('select', {}, c.keuzes.map((k) => el('option', { value: k, text: k })))
      : el('input', { type: c.type || 'text', placeholder: c.label }),
  }));
  const add = el('button', { class: 'btn', text: newLabel });
  add.addEventListener('click', async () => {
    const body = Object.fromEntries(fields.map(({ c, node }) => [c.k, node.value]));
    if (withCompany) body.company_id = state.companyId;
    if (!String(body.name || '').trim()) return toast('Een naam is verplicht.', true);
    try {
      await api(endpoint, { method: 'POST', body });
      toast('Toegevoegd.');
      if (reloadAfter) return location.reload();
      await refresh(); renderTab();
    } catch (err) { toast(err.message, true); }
  });
  card.append(el('div', { class: 'row mt-2 align-end' }, [
    ...fields.map(({ c, node }) => el('div', { class: 'f-field' }, [el('label', { text: c.label }), node])),
    el('div', { class: 'f-fixed' }, [add]),
  ]));
  return card;
}

/* ---------------- redenen voor een stockbeweging ---------------- */

/**
 * Waarom er drank uit de stock gaat of erbij komt: "Drank Rode Kruis", "Drank bussen", "Breuk".
 * De richting bepaalt waar de reden verschijnt bij het boeken van een beweging.
 */
function renderReasons(panel) {
  panel.append(
    el('p', { class: 'page-intro small muted', text: 'Deze redenen kies je bij Stock → "Drank uit de stock nemen of toevoegen". Ze komen mee in de tijdlijn, zodat achteraf te zien is waar de drank naartoe ging.' }),
    crudTable({
      title: `Redenen van ${state.company ? state.company.name : '—'}`, endpoint: '/api/admin/reasons', table: null,
      items: state.reasons, newLabel: 'Reden toevoegen',
      columns: [
        { k: 'name', label: 'Naam' },
        { k: 'direction', label: 'Richting', type: 'text', narrow: true, keuzes: ['uit', 'in', 'beide'] },
      ],
    }),
    el('p', { class: 'small muted', text: '"uit" = drank verlaat de stock (weggegeven, breuk), "in" = er komt drank bij (teruggebracht, gevonden), "beide" = allebei.' }),
  );
}

/* ---------------- toegang ---------------- */

async function loadCodes() {
  try {
    const res = await api('/api/admin/codes');
    state.codes = res.codes || [];
  } catch { state.codes = []; }
}

/**
 * De cijfercodes waarmee de tool opengaat. Elke code draagt haar eigen rechten: een code voor
 * één bedrijf laat enkel dat bedrijf zien, en 'tellen' houdt het beheer dicht.
 */
function renderCodes(panel) {
  const tbody = el('tbody', {});
  for (const c of state.codes) {
    const del = el('button', { class: 'btn btn--sm btn--danger', text: 'Wis' });
    del.addEventListener('click', async () => {
      if (!confirm(`Code ${c.code} (${c.label}) verwijderen? Wie ze gebruikt, staat er meteen buiten.`)) return;
      try {
        const res = await api(`/api/admin/codes?code=${encodeURIComponent(c.code)}`, { method: 'DELETE' });
        state.codes = res.codes || [];
        toast('Code verwijderd.');
        renderTab();
      } catch (err) { toast(err.message, true); }
    });
    tbody.append(el('tr', {}, [
      el('td', {}, [el('b', { text: c.code })]),
      el('td', { text: c.label }),
      el('td', { text: c.company_name || 'Alle bedrijven' }),
      el('td', { text: c.role === 'beheerder' ? 'alles beheren' : 'enkel tellen' }),
      el('td', {}, [del]),
    ]));
  }
  if (!state.codes.length) tbody.append(el('tr', {}, [el('td', { colspan: '5', class: 'muted', text: 'Geen codes: de tool vraagt niets en staat open.' })]));

  const code = el('input', { type: 'text', inputmode: 'numeric', maxlength: '8', placeholder: '1234' });
  const label = el('input', { type: 'text', placeholder: 'Tellen Bistro' });
  const bedrijf = el('select', {}, [el('option', { value: '', text: 'Alle bedrijven' }),
    ...state.companies.map((c) => el('option', { value: String(c.id), text: c.name }))]);
  const rol = el('select', {}, [
    el('option', { value: 'teller', text: 'enkel tellen' }),
    el('option', { value: 'beheerder', text: 'alles beheren' }),
  ]);
  const add = el('button', { class: 'btn', text: 'Code toevoegen' });
  add.addEventListener('click', async () => {
    try {
      const res = await api('/api/admin/codes', {
        method: 'POST',
        body: { code: code.value, label: label.value, role: rol.value, company_id: bedrijf.value || null },
      });
      state.codes = res.codes || [];
      code.value = ''; label.value = '';
      toast('Code bewaard.');
      renderTab();
    } catch (err) { toast(err.message, true); }
  });

  panel.append(el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [el('h2', { text: 'Toegangscodes' })]),
    el('p', { class: 'small muted', text: 'Wie de tool opent, geeft eerst een van deze codes. De code bepaalt ook wat je mag: een code voor één bedrijf toont enkel dat bedrijf, en "enkel tellen" houdt het beheer dicht. De browser onthoudt de code dertig dagen.' }),
    el('div', { class: 'table-wrap mt-2' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Code' }), el('th', { text: 'Waarvoor' }), el('th', { text: 'Bedrijf' }),
        el('th', { text: 'Mag' }), el('th', { text: '' }),
      ])]),
      tbody,
    ])]),
    el('div', { class: 'row mt-2 align-end' }, [
      el('div', { class: 'f-field' }, [el('label', { text: 'Code (4–8 cijfers)' }), code]),
      el('div', { class: 'f-field-wide' }, [el('label', { text: 'Waarvoor dient ze' }), label]),
      el('div', { class: 'f-field' }, [el('label', { text: 'Bedrijf' }), bedrijf]),
      el('div', { class: 'f-field' }, [el('label', { text: 'Mag' }), rol]),
      el('div', { class: 'f-fixed' }, [add]),
    ]),
    el('p', { class: 'small muted mt-1', text: 'Er blijft altijd één code met volledige toegang over. Sluit je jezelf toch buiten, zet dan APP_PIN als variabele op het Pages-project.' }),
  ]));
}

function renderAccess(panel) {
  panel.append(el('p', { class: 'page-intro small muted', text: 'De toegang tot de tool loopt volledig via cijfercodes: de code die iemand invoert, bepaalt ook wat hij mag en welk bedrijf hij ziet.' }));
  renderCodes(panel);
}

/* ---------------- tabs ---------------- */

function renderTab() {
  const panel = clear(qs('#panel'));
  if (!state.companyId && state.tab !== 'bedrijven') {
    panel.append(el('div', { class: 'notice', text: 'Maak eerst een bedrijf aan in de tab Bedrijven.' }));
    return;
  }
  if (!state.canManage && state.tab !== 'toegang') {
    panel.append(el('div', { class: 'notice', text: `Je mag ${state.company ? state.company.name : 'dit bedrijf'} bekijken en tellen, maar niet beheren. Vraag een beheerder om aanpassingen.` }));
    return;
  }
  if (state.tab === 'producten') renderProducts(panel);
  else if (state.tab === 'locaties') panel.append(crudTable({
    title: `Locaties van ${state.company ? state.company.name : '—'}`, endpoint: '/api/admin/locations', table: 'locations',
    items: state.locations, newLabel: 'Locatie toevoegen', columns: [{ k: 'name', label: 'Naam' }],
  }));
  else if (state.tab === 'leveranciers') panel.append(crudTable({
    title: `Leveranciers van ${state.company ? state.company.name : '—'}`, endpoint: '/api/admin/suppliers', table: 'suppliers',
    items: state.suppliers, newLabel: 'Leverancier toevoegen', columns: [{ k: 'name', label: 'Naam' }], withActive: false,
  }));
  else if (state.tab === 'redenen') renderReasons(panel);
  else if (state.tab === 'toegang') renderAccess(panel);
  else if (state.tab === 'bedrijven') {
    panel.append(
      el('p', { class: 'page-intro small muted', text: 'Elk bedrijf heeft zijn eigen locaties, leveranciers en producten. De naam komt bovenaan de bestelbon.' }),
      crudTable({
        title: 'Bedrijven', endpoint: '/api/admin/companies', table: 'companies', items: state.companies,
        newLabel: 'Bedrijf toevoegen', withCompany: false, columns: [{ k: 'name', label: 'Naam' }],
      }),
    );
  }
}

async function init() {
  const header = await mountHeader('beheer');
  state.companyId = header.companyId;
  state.canManage = header.canManage;
  state.superAdmin = header.superAdmin;
  if (!state.superAdmin) qsa('[data-super-only]').forEach((n) => n.classList.add('hidden'));
  await refresh();
  if (state.superAdmin) await loadCodes();
  if (!state.companyId) state.tab = state.superAdmin ? 'bedrijven' : 'toegang';
  else if (!state.canManage) state.tab = 'toegang';
  qsa('.tabs button').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === state.tab));
    btn.addEventListener('click', () => {
      state.tab = btn.dataset.tab;
      qsa('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      renderTab();
    });
  });
  renderTab();
}

init().catch((err) => {
  clear(qs('#panel'));
  qs('#messages').replaceChildren(el('div', { class: 'notice notice--error', text: err.message }));
});
