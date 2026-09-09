// Beheerscherm. Alles hangt aan het bedrijf dat bovenaan gekozen is: producten met hun
// basisstock per locatie, locaties, leveranciers, import/export en de bedrijfsgegevens zelf.
import { api, toast, fmt, num, el, clear, qs, qsa, mountHeader, plural } from './app.js';
import { readWorkbook, interpretBestellijst, interpretPerLocation, looksPerLocation } from './xlsx-read.js';

const state = {
  companyId: null, company: null, locations: [], suppliers: [], products: [], companies: [],
  members: [], settings: {}, tab: 'producten', canManage: true, superAdmin: true,
};

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
    id: p.id, company_id: state.companyId, name: p.name,
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
      el('th', { text: 'Product' }), el('th', { text: 'Leverancier' }), el('th', { text: 'Eenheid' }), el('th', { text: 'Per verp.' }), el('th', { text: 'Verpakking' }),
      ...activeLocations.map((l) => el('th', { class: 'num', text: `Basis ${l.name}` })),
      el('th', { text: '' }),
    ])]),
    tbody,
  ])]);

  const fill = (term = '') => {
    clear(tbody);
    const list = state.products.filter((p) => !term || `${p.name} ${p.supplier_name || ''}`.toLowerCase().includes(term));
    if (!list.length) tbody.append(el('tr', {}, [el('td', { colspan: String(6 + activeLocations.length), class: 'muted', text: 'Geen producten gevonden.' })]));
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
  const file = el('input', { type: 'file', accept: '.xlsx,.csv,text/csv,text/plain' });
  const out = el('div', {});
  const preview = el('button', { class: 'btn btn--ghost', text: 'Controleren' });
  const apply = el('button', { class: 'btn', text: 'Importeren', disabled: true });
  const values = el('select', {}, [
    el('option', { value: 'base_packs', text: 'Basisstock in volle bakken, dozen of vaten' }),
    el('option', { value: 'base', text: 'Basisstock in losse stuks' }),
    el('option', { value: 'ignore', text: 'Alleen producten en locaties overnemen' }),
  ]);
  const valuesRow = el('div', { class: 'f-16 hidden' }, [el('label', { text: 'Wat staat er in de cijferkolom?' }), values]);

  let workbook = null;    // ingelezen tabbladen uit een xlsx

  const summary = (parsed, shape) => {
    const locaties = new Set();
    let waarden = 0;
    let producten = 0;
    for (const supplier of parsed.suppliers) {
      for (const name of supplier.locations || []) locaties.add(name);
      producten += supplier.products.length;
      for (const product of supplier.products) waarden += Object.keys(product.values || {}).length;
    }
    return el('div', { class: 'notice' }, [
      el('b', { text: shape === 'per-locatie' ? 'Werkboek met één tabblad per locatie' : 'Werkboek in de vorm van de bestellijst' }),
      el('ul', {}, [
        el('li', { text: `Leveranciers: ${parsed.suppliers.map((s) => s.name || 'zonder leverancier').join(', ')}` }),
        el('li', { text: `Locaties: ${[...locaties].join(', ') || 'geen'}` }),
        el('li', { text: `${plural(producten, 'product', 'producten')} met ${waarden} ingevulde waarden` }),
      ]),
      ...(parsed.warnings || []).slice(0, 8).map((w) => el('p', { class: 'small', text: `⚠ ${w}` })),
      el('p', { class: 'small muted', text: 'Klik op Controleren om te zien wat er zou veranderen; pas daarna Importeren.' }),
    ]);
  };

  file.addEventListener('change', async () => {
    const chosen = file.files && file.files[0];
    if (!chosen) return;
    workbook = null;
    valuesRow.classList.add('hidden');
    apply.disabled = true;
    clear(out);

    if (!/\.xlsx$/i.test(chosen.name)) {
      area.value = await chosen.text();
      toast(`${chosen.name} ingelezen — klik op Controleren.`);
      return;
    }
    try {
      const sheets = await readWorkbook(chosen);
      const perLocation = looksPerLocation(sheets);
      const parsed = perLocation
        ? interpretPerLocation(sheets, { knownSuppliers: state.suppliers.map((s) => s.name) })
        : interpretBestellijst(sheets);
      if (!parsed.suppliers.length) throw new Error('Geen bruikbare tabbladen gevonden in dit bestand.');
      workbook = parsed;
      values.value = perLocation ? 'base_packs' : 'ignore';
      valuesRow.classList.remove('hidden');
      area.value = '';
      out.append(summary(parsed, perLocation ? 'per-locatie' : 'bestellijst'));
    } catch (err) {
      toast(err.message, true);
    }
  });

  const run = async (mode) => {
    const body = { company_id: state.companyId, mode };
    if (workbook) {
      body.sheets = workbook.suppliers;
      body.values = values.value;
    } else if (area.value.trim()) {
      body.csv = area.value;
    } else {
      return toast('Kies een bestand of plak een CSV.', true);
    }
    try {
      const res = await api('/api/admin/import', { method: 'POST', body });
      const r = res.report;
      clear(out).append(el('div', { class: res.preview ? 'notice' : 'notice notice--ok' }, [
        el('b', { text: res.preview ? `Voorbeeld voor ${r.company} — er is nog niets gewijzigd` : `Import uitgevoerd voor ${r.company}` }),
        el('ul', {}, [
          el('li', { text: `${plural(r.rows, 'productrij', 'productrijen')}: ${r.products_new} nieuw, ${r.products_updated} bijgewerkt` }),
          el('li', { text: `Locaties: ${r.locations_used.join(', ') || 'geen'}${r.locations_new.length ? ` (nieuw: ${r.locations_new.join(', ')})` : ''}` }),
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
  apply.addEventListener('click', () => { if (confirm(`De catalogus van ${state.company ? state.company.name : 'dit bedrijf'} bijwerken?`)) run('apply'); });

  panel.append(
    el('section', { class: 'card' }, [
      el('h2', { text: `Catalogus importeren voor ${state.company ? state.company.name : '—'}` }),
      el('p', { class: 'small muted', text: 'Twee vormen worden herkend. (1) Een Excel-bestand met één tabblad per locatie, met de producten in kolom A en een kolom "Begin Stock" — dat is de stocktelling zoals ze vandaag gebruikt wordt. (2) Een CSV of Excel in de vorm van de bestellijst: één tabblad per leverancier met de locaties als kolommen. Onbekende locaties, leveranciers en producten worden binnen dit bedrijf aangemaakt.' }),
      el('div', { class: 'my-1' }, [file]),
      valuesRow,
      el('details', { class: 'mt-1' }, [
        el('summary', { text: 'Of een CSV plakken' }),
        el('p', { class: 'small muted mt-1', text: 'Kolommen: Product · Eenheid · Verpakking · Verpakkingsnaam · Leverancier, gevolgd door één kolom per locatie met de basisstock.' }),
        area,
      ]),
      el('div', { class: 'row mt-1' }, [preview, apply]),
      out,
    ]),
    el('section', { class: 'card' }, [
      el('h2', { text: 'Catalogus exporteren' }),
      el('p', { class: 'small muted', text: 'Zelfde kolommen als de CSV-import: aanpassen in Excel en opnieuw importeren.' }),
      el('a', { class: 'btn btn--ghost mt-1', href: `/api/admin/export?company_id=${state.companyId}`, text: 'Producten + basisstock (CSV)' }),
    ]),
  );
}

/* ---------------- toegang ---------------- */

async function loadMembers() {
  try {
    const res = await api(`/api/admin/members?company_id=${state.companyId}`);
    state.members = res.members || [];
    state.membersConfigured = res.configured;
  } catch { state.members = []; }
}

function renderAccess(panel) {
  const naam = state.company ? state.company.name : '—';
  const tbody = el('tbody', {});
  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [el('h2', { text: `Wie mag bij ${naam}` })]),
    el('p', { class: 'small muted' }, [
      state.membersConfigured
        ? 'Enkel de adressen hieronder zien dit bedrijf. Een teller mag tellen en bestellingen bekijken; een beheerder mag ook de catalogus aanpassen.'
        : 'Er is nog niemand toegevoegd, dus iedereen die door Cloudflare Access geraakt, ziet alle bedrijven. Zodra je hier het eerste adres toevoegt, telt deze lijst — voeg dus eerst jezelf toe.',
    ]),
    el('div', { class: 'table-wrap mt-2' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'E-mailadres' }), el('th', { text: 'Rol' }), el('th', { text: '' })])]),
      tbody,
    ])]),
  ]);

  for (const member of state.members) {
    const rol = el('select', { 'aria-label': `Rol van ${member.email}` }, [
      el('option', { value: 'teller', text: 'teller — mag tellen' }),
      el('option', { value: 'beheerder', text: 'beheerder — mag ook de catalogus aanpassen' }),
    ]);
    rol.value = member.role;
    rol.addEventListener('change', async () => {
      try {
        await api('/api/admin/members', { method: 'POST', body: { company_id: state.companyId, email: member.email, role: rol.value } });
        toast(`${member.email} is nu ${rol.value}.`);
        await loadMembers();
      } catch (err) { toast(err.message, true); rol.value = member.role; }
    });
    const del = el('button', { class: 'btn btn--sm btn--danger', text: 'Wis' });
    del.addEventListener('click', async () => {
      if (!confirm(`${member.email} de toegang tot ${naam} ontnemen?`)) return;
      try {
        const res = await api(`/api/admin/members?company_id=${state.companyId}&email=${encodeURIComponent(member.email)}`, { method: 'DELETE' });
        toast(res.message || 'Verwijderd.');
        await loadMembers();
        renderTab();
      } catch (err) { toast(err.message, true); }
    });
    tbody.append(el('tr', {}, [el('td', { text: member.email }), el('td', {}, [rol]), el('td', {}, [del])]));
  }
  if (!state.members.length) tbody.append(el('tr', {}, [el('td', { colspan: '3', class: 'muted', text: 'Nog niemand toegevoegd.' })]));

  const email = el('input', { type: 'email', placeholder: 'naam@bedrijf.be' });
  const role = el('select', {}, [
    el('option', { value: 'teller', text: 'teller' }),
    el('option', { value: 'beheerder', text: 'beheerder' }),
  ]);
  const add = el('button', { class: 'btn', text: 'Toegang geven' });
  add.addEventListener('click', async () => {
    if (!email.value.trim()) return toast('Vul een e-mailadres in.', true);
    try {
      const res = await api('/api/admin/members', { method: 'POST', body: { company_id: state.companyId, email: email.value, role: role.value } });
      toast(res.message || 'Toegevoegd.');
      email.value = '';
      await loadMembers();
      renderTab();
    } catch (err) { toast(err.message, true); }
  });
  card.append(el('div', { class: 'row mt-2 align-end' }, [
    el('div', { class: 'f-field-wide' }, [el('label', { text: 'E-mailadres (zoals in Cloudflare Access)' }), email]),
    el('div', { class: 'f-field' }, [el('label', { text: 'Rol' }), role]),
    el('div', { class: 'f-fixed' }, [add]),
  ]));
  panel.append(card, el('p', { class: 'small muted', text: 'Hoofdbeheerders staan in de variabele ADMIN_EMAILS van de omgeving; die mogen altijd overal aan, ook bedrijven aanmaken.' }));
}

/* ---------------- instellingen ---------------- */

function renderSettings(panel) {
  const pin = el('input', { type: 'text', inputmode: 'numeric', maxlength: '8', id: 'app-pin', value: state.settings.pin || '' });
  const delimiter = el('select', { id: 'csv-delimiter' }, [
    el('option', { value: ';', text: 'Puntkomma ;  (Excel België/Nederland)' }),
    el('option', { value: ',', text: 'Komma ,' }),
    el('option', { value: '\t', text: 'Tab' }),
  ]);
  delimiter.value = state.settings.csv_delimiter || ';';
  const save = el('button', { class: 'btn', text: 'Bewaren' });
  save.addEventListener('click', async () => {
    try {
      const res = await api('/api/admin/settings', { method: 'POST', body: { csv_delimiter: delimiter.value, pin: pin.value } });
      state.settings = res.settings;
      toast(res.settings.pin ? 'Instellingen bewaard. De nieuwe code geldt meteen; iedereen moet opnieuw invoeren.' : 'Instellingen bewaard. Er wordt geen code meer gevraagd.');
    } catch (err) { toast(err.message, true); }
  });

  panel.append(el('section', { class: 'card' }, [
    el('h2', { text: 'Algemene instellingen' }),
    el('p', { class: 'small muted', text: 'De naam, het adres en de voettekst op de bestelbon staan bij het bedrijf zelf (tab Bedrijven).' }),
    el('div', { class: 'field-narrow mt-2' }, [
      el('label', { for: 'app-pin', text: 'Toegangscode (4 tot 8 cijfers, leeg = geen code)' }), pin,
      el('p', { class: 'small muted mt-1', text: 'Wie de tool opent, geeft eerst deze code. De browser onthoudt ze dertig dagen. Verander je de code, dan moet iedereen ze opnieuw invoeren.' }),
    ]),
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
  if (!state.canManage && state.tab !== 'toegang') {
    panel.append(el('div', { class: 'notice', text: `Je mag ${state.company ? state.company.name : 'dit bedrijf'} bekijken en tellen, maar niet beheren. Vraag een beheerder om aanpassingen.` }));
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
  else if (state.tab === 'toegang') renderAccess(panel);
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
  state.canManage = header.canManage;
  state.superAdmin = header.superAdmin;
  if (!state.superAdmin) qsa('[data-super-only]').forEach((n) => n.classList.add('hidden'));
  await refresh();
  if (state.companyId) await loadMembers();
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
