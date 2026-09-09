// Beheerscherm. Alles hangt aan het bedrijf dat bovenaan gekozen is: producten met hun
// basisstock per locatie, locaties, leveranciers, import/export en de bedrijfsgegevens zelf.
import { api, toast, fmt, num, el, clear, qs, qsa, mountHeader, plural } from './app.js';

const state = { companyId: null, company: null, locations: [], suppliers: [], products: [], companies: [], settings: {}, tab: 'producten' };

const input = (props) => el('input', { type: 'text', ...props });

async function refresh() {
  const data = await api(`/api/catalog${state.companyId ? `?company_id=${state.companyId}&all=1` : ''}`);
  state.companies = data.companies || [];
  state.company = data.company || null;
  state.locations = data.locations || [];
  state.suppliers = data.suppliers || [];
  state.products = data.products || [];
  state.settings = data.settings || {};
}

/* ---------------- producten ---------------- */

function productRow(p, activeLocations) {
  const values = {
    id: p.id, company_id: state.companyId, name: p.name, sku: p.sku || '', category: p.category || '',
    unit: p.unit || 'stuk', pack_size: p.pack_size, pack_label: p.pack_label || '',
    supplier_id: p.supplier_id || '', active: p.active !== 0, base: { ...(p.base || {}) },
  };
  const tr = el('tr', {});
  const save = el('button', { class: 'btn btn--sm', disabled: true, text: 'Bewaar' });
  const bind = (node, key) => {
    node.addEventListener('input', () => { values[key] = node.value; save.disabled = false; });
    return node;
  };

  tr.append(
    el('td', {}, [bind(input({ value: values.name, 'aria-label': 'Productnaam' }), 'name')]),
    el('td', { class: 'cell-narrow' }, [bind(input({ value: values.sku, 'aria-label': 'Artikelnummer' }), 'sku')]),
    el('td', { class: 'cell-narrow' }, [bind(input({ value: values.category, 'aria-label': 'Categorie' }), 'category')]),
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
  fields.sku = input({ placeholder: 'Art.nr' });
  fields.category = input({ placeholder: 'Categorie' });
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
      name: fields.name.value, sku: fields.sku.value, category: fields.category.value,
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
      field('Naam', fields.name, 'f-field-wide'), field('Art.nr', fields.sku), field('Categorie', fields.category),
      field('Leverancier', fields.supplier), field('Eenheid', fields.unit), field('Per volle verpakking', fields.pack_size),
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

  const search = el('input', { type: 'search', placeholder: 'zoek product, artikelnummer of categorie' });
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
      el('th', { text: 'Product' }), el('th', { text: 'Art.nr' }), el('th', { text: 'Categorie' }),
      el('th', { text: 'Leverancier' }), el('th', { text: 'Eenheid' }), el('th', { text: 'Per verp.' }), el('th', { text: 'Verpakking' }),
      ...activeLocations.map((l) => el('th', { class: 'num', text: `Basis ${l.name}` })),
      el('th', { text: '' }),
    ])]),
    tbody,
  ])]);

  const fill = (term = '') => {
    clear(tbody);
    const list = state.products.filter((p) => !term || `${p.name} ${p.sku || ''} ${p.category || ''} ${p.supplier_name || ''}`.toLowerCase().includes(term));
    if (!list.length) tbody.append(el('tr', {}, [el('td', { colspan: String(8 + activeLocations.length), class: 'muted', text: 'Geen producten gevonden.' })]));
    for (const p of list) tbody.append(productRow(p, activeLocations));
  };
  fill();
  search.addEventListener('input', () => fill(search.value.trim().toLowerCase()));

  card.append(table, el('p', { class: 'small muted mt-1', text: 'Een lege basisstock betekent: dit product hoort niet in die locatie en verschijnt daar niet op het telformulier.' }));
  panel.append(card);
}

/* ---------------- eenvoudige tabellen ---------------- */

function crudTable({ title, endpoint, items, columns, newLabel, withCompany = true }) {
  // Bij bedrijven verandert ook de keuzelijst bovenaan: het scherm wordt opnieuw opgebouwd.
  const reloadAfter = endpoint.endsWith('/companies');
  const tbody = el('tbody', {});
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [el('h2', { text: `${title} (${items.length})` })]),
    el('div', { class: 'table-wrap' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, [...columns.map((c) => el('th', { text: c.label })), el('th', { text: 'Actief' }), el('th', { text: '' })])]),
      tbody,
    ])]),
  ]);

  for (const item of items) {
    const values = { ...item, active: item.active !== 0 };
    const save = el('button', { class: 'btn btn--sm', disabled: true, text: 'Bewaar' });
    const tr = el('tr', {}, columns.map((c) => {
      const node = el('input', {
        type: c.type || 'text',
        value: values[c.k] === null || values[c.k] === undefined ? '' : String(values[c.k]),
        'aria-label': `${c.label} ${item.name}`,
      });
      node.addEventListener('input', () => { values[c.k] = node.value; save.disabled = false; });
      return el('td', { class: c.narrow ? 'cell-narrow' : '' }, [node]);
    }));
    const active = el('input', { type: 'checkbox', checked: values.active, class: 'check', 'aria-label': `Actief ${item.name}` });
    active.addEventListener('change', () => { values.active = active.checked; save.disabled = false; });
    tr.append(el('td', {}, [active]));

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
  if (!items.length) tbody.append(el('tr', {}, [el('td', { colspan: String(columns.length + 2), class: 'muted', text: 'Nog niets toegevoegd.' })]));

  const fields = columns.map((c) => ({ c, node: el('input', { type: c.type || 'text', placeholder: c.label }) }));
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

/* ---------------- import / export ---------------- */

function renderImport(panel) {
  const area = el('textarea', { class: 'code-area', placeholder: 'Plak hier de inhoud van je CSV-bestand…' });
  const file = el('input', { type: 'file', accept: '.csv,text/csv,text/plain' });
  const out = el('div', {});
  const preview = el('button', { class: 'btn btn--ghost', text: 'Controleren' });
  const apply = el('button', { class: 'btn', text: 'Importeren', disabled: true });

  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    area.value = await f.text();
    toast(`${f.name} ingelezen — klik op Controleren.`);
  });

  const run = async (mode) => {
    if (!area.value.trim()) return toast('Plak eerst een CSV of kies een bestand.', true);
    try {
      const res = await api('/api/admin/import', { method: 'POST', body: { company_id: state.companyId, csv: area.value, mode } });
      const r = res.report;
      clear(out).append(el('div', { class: res.preview ? 'notice' : 'notice notice--ok' }, [
        el('b', { text: res.preview ? `Voorbeeld voor ${r.company} — er is nog niets gewijzigd` : `Import uitgevoerd voor ${r.company}` }),
        el('ul', {}, [
          el('li', { text: `${plural(r.rows, 'productrij', 'productrijen')}: ${r.products_new} nieuw, ${r.products_updated} bijgewerkt` }),
          el('li', { text: `Locatiekolommen: ${r.locations_used.join(', ') || 'geen'}${r.locations_new.length ? ` (nieuw: ${r.locations_new.join(', ')})` : ''}` }),
          el('li', { text: `Nieuwe leveranciers: ${r.suppliers_new.join(', ') || 'geen'}` }),
          el('li', { text: `${r.par_rows} basisstock-waarden` }),
        ]),
        ...(r.warnings || []).slice(0, 10).map((w) => el('p', { class: 'small', text: `⚠ ${w}` })),
      ]));
      apply.disabled = !res.preview;
      if (!res.preview) { await refresh(); toast('Catalogus bijgewerkt.'); }
    } catch (err) { toast(err.message, true); }
  };
  preview.addEventListener('click', () => run('preview'));
  apply.addEventListener('click', () => { if (confirm(`De catalogus van ${state.company ? state.company.name : 'dit bedrijf'} bijwerken met deze CSV?`)) run('apply'); });

  panel.append(
    el('section', { class: 'card' }, [
      el('h2', { text: `Catalogus importeren voor ${state.company ? state.company.name : '—'}` }),
      el('p', { class: 'small muted', text: 'Kolommen: Product · Artikelnummer · Eenheid · Verpakking · Verpakkingsnaam · Categorie · Leverancier. Elke extra kolom is een locatie; de waarde in die kolom is de basisstock voor die locatie. Een lege cel betekent dat het product niet in die locatie staat. Onbekende locaties en leveranciers worden binnen dit bedrijf aangemaakt.' }),
      el('div', { class: 'my-1' }, [file]),
      area,
      el('div', { class: 'row mt-1' }, [preview, apply]),
      out,
    ]),
    el('section', { class: 'card' }, [
      el('h2', { text: 'Catalogus exporteren' }),
      el('p', { class: 'small muted', text: 'Zelfde kolommen als de import: pas het bestand aan in Excel en importeer het opnieuw.' }),
      el('a', { class: 'btn btn--ghost mt-1', href: `/api/admin/export?company_id=${state.companyId}`, text: 'Producten + basisstock (CSV)' }),
    ]),
  );
}

/* ---------------- instellingen ---------------- */

function renderSettings(panel) {
  const delimiter = el('select', { id: 'csv-delimiter' }, [
    el('option', { value: ';', text: 'Puntkomma ;  (Excel België/Nederland)' }),
    el('option', { value: ',', text: 'Komma ,' }),
    el('option', { value: '\t', text: 'Tab' }),
  ]);
  delimiter.value = state.settings.csv_delimiter || ';';
  const save = el('button', { class: 'btn', text: 'Bewaren' });
  save.addEventListener('click', async () => {
    try {
      const res = await api('/api/admin/settings', { method: 'POST', body: { csv_delimiter: delimiter.value } });
      state.settings = res.settings;
      toast('Instellingen bewaard.');
    } catch (err) { toast(err.message, true); }
  });

  panel.append(el('section', { class: 'card' }, [
    el('h2', { text: 'Algemene instellingen' }),
    el('p', { class: 'small muted', text: 'De naam, het adres en de voettekst op de bestelbon staan bij het bedrijf zelf (tab Bedrijven).' }),
    el('div', { class: 'field-narrow mt-2' }, [el('label', { for: 'csv-delimiter', text: 'CSV-scheidingsteken' }), delimiter]),
    el('div', { class: 'mt-2' }, [save]),
  ]));
}

/* ---------------- tabs ---------------- */

function renderTab() {
  const panel = clear(qs('#panel'));
  if (!state.companyId && state.tab !== 'bedrijven') {
    panel.append(el('div', { class: 'notice', text: 'Maak eerst een bedrijf aan in de tab Bedrijven.' }));
    return;
  }
  if (state.tab === 'producten') renderProducts(panel);
  else if (state.tab === 'locaties') panel.append(crudTable({
    title: `Locaties van ${state.company ? state.company.name : '—'}`, endpoint: '/api/admin/locations', items: state.locations, newLabel: 'Locatie toevoegen',
    columns: [{ k: 'name', label: 'Naam' }, { k: 'sort', label: 'Volgorde', type: 'number', narrow: true }],
  }));
  else if (state.tab === 'leveranciers') panel.append(crudTable({
    title: `Leveranciers van ${state.company ? state.company.name : '—'}`, endpoint: '/api/admin/suppliers', items: state.suppliers, newLabel: 'Leverancier toevoegen',
    columns: [{ k: 'name', label: 'Naam' }, { k: 'email', label: 'E-mail', narrow: true }, { k: 'customer_ref', label: 'Klantnummer', narrow: true }, { k: 'sort', label: 'Volgorde', type: 'number', narrow: true }],
  }));
  else if (state.tab === 'import') renderImport(panel);
  else if (state.tab === 'bedrijven') {
    panel.append(
      el('p', { class: 'page-intro small muted', text: 'Elk bedrijf heeft zijn eigen locaties, leveranciers en producten. Deze gegevens komen op de bestelbon.' }),
      crudTable({
        title: 'Bedrijven', endpoint: '/api/admin/companies', items: state.companies, newLabel: 'Bedrijf toevoegen', withCompany: false,
        columns: [
          { k: 'name', label: 'Naam' }, { k: 'address', label: 'Adresregel' }, { k: 'vat', label: 'BTW-nummer', narrow: true },
          { k: 'email', label: 'E-mail', narrow: true }, { k: 'order_footer', label: 'Voettekst bestelbon' },
          { k: 'sort', label: 'Volgorde', type: 'number', narrow: true },
        ],
      }),
    );
  } else renderSettings(panel);
}

async function init() {
  const header = await mountHeader('beheer');
  state.companyId = header.companyId;
  if (header.user && header.user.admin === false) {
    qs('#messages').replaceChildren(el('div', { class: 'notice notice--error', text: 'Je hebt geen beheerrechten. Vraag een beheerder om je adres toe te voegen aan ADMIN_EMAILS.' }));
  }
  await refresh();
  if (!state.companyId) state.tab = 'bedrijven';
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
