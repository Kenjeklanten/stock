// Wat er nú in huis is, waar dat getal vandaan komt, en de tijdlijn per product.
// Hier worden ook de bewegingen geboekt die niet uit een telling of levering volgen:
// drank voor het Rode Kruis, voor de bussen, breuk, personeel.
import { api, toast, fmt, num, el, clear, qs, params, mountHeader, dateNl, today, plural } from './app.js';

const state = {
  companyId: null, canManage: false,
  locations: [], products: [], reasons: [],
  stock: [], locationId: null, zoek: '',
};

const SOORT = {
  telling: { label: 'Telling', klasse: 'tag' },
  levering: { label: 'Levering', klasse: 'tag tag--mint' },
  besteld: { label: 'Besteld', klasse: 'tag tag--sun' },
  beweging: { label: 'Beweging', klasse: 'tag tag--grape' },
  verkoop: { label: 'Verkoop', klasse: 'tag' },
};

/* ---------------- tijdlijn van één product ---------------- */

async function toonTijdlijn(locationId, productId) {
  const content = clear(qs('#content'));
  content.append(el('p', { class: 'skeleton', text: 'Tijdlijn laden…' }));
  const data = await api(`/api/stock?company_id=${state.companyId}&location_id=${locationId}&product_id=${productId}&timeline=1`);
  clear(content);

  const nu = data.events.length ? data.events[0].saldo : null;
  content.append(el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [
      el('h1', { text: data.product.name }),
      el('span', { class: 'tag', text: data.location.name }),
    ]),
    el('p', { class: 'muted small', text: `Elke telling, levering, beweging en verkoopdag van dit product op deze toog. Een telling zet de stand vast; de rest telt erbij of eraf.` }),
    el('div', { class: 'kpis mt-2' }, [
      el('div', { class: 'kpi' }, [
        el('b', { class: 'kpi__value', text: nu === null ? '—' : `${fmt(nu)} ${data.product.unit || 'stuk'}` }),
        el('span', { class: 'kpi__label', text: 'nu in huis' }),
      ]),
      el('div', { class: 'kpi' }, [
        el('b', { class: 'kpi__value', text: String(data.events.length) }),
        el('span', { class: 'kpi__label', text: 'gebeurtenissen' }),
      ]),
    ]),
    el('div', { class: 'row mt-2' }, [
      el('a', { class: 'btn btn--ghost', href: `/stock?location_id=${locationId}`, text: 'Terug naar de stock' }),
    ]),
  ]));

  if (!data.events.length) {
    content.append(el('div', { class: 'notice', text: 'Er is voor dit product nog niets geteld op deze toog.' }));
    return;
  }

  const rijen = data.events.map((e) => {
    const soort = SOORT[e.soort] || { label: e.soort, klasse: 'tag' };
    const verschil = e.soort === 'telling'
      ? el('b', { text: `= ${fmt(e.stand)}` })
      : (e.delta ? el('b', { class: e.delta > 0 ? 'ok' : 'bad', text: `${e.delta > 0 ? '+' : ''}${fmt(e.delta)}` }) : el('span', { class: 'muted', text: '—' }));
    return el('tr', {}, [
      el('td', { text: dateNl(e.op) }),
      el('td', {}, [el('span', { class: soort.klasse, text: soort.label })]),
      el('td', {}, [
        el('span', { text: e.tekst }),
        e.note ? el('div', { class: 'small muted', text: e.note }) : null,
        e.door ? el('div', { class: 'small muted', text: e.door }) : null,
      ]),
      el('td', { class: 'num' }, [verschil]),
      el('td', { class: 'num', text: e.saldo === null ? '—' : fmt(e.saldo) }),
    ]);
  });

  content.append(el('section', { class: 'card' }, [
    el('div', { class: 'table-wrap' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Datum' }), el('th', { text: 'Wat' }), el('th', { text: 'Toelichting' }),
        el('th', { class: 'num', text: 'Verschil' }), el('th', { class: 'num', text: 'Stand' }),
      ])]),
      el('tbody', {}, rijen),
    ])]),
  ]));
}

/* ---------------- beweging boeken ---------------- */

let formVelden = null;

function bewegingsForm() {
  const locatie = el('select', { id: 'mv-loc' }, state.locations.map((l) => el('option', { value: String(l.id), text: l.name })));
  const product = el('select', { id: 'mv-prod' });
  const richting = el('select', { id: 'mv-dir' }, [
    el('option', { value: '-1', text: 'gaat eruit' }),
    el('option', { value: '1', text: 'komt erbij' }),
  ]);
  const aantal = el('input', { type: 'number', min: '0', step: 'any', id: 'mv-qty', placeholder: '0' });
  const reden = el('select', { id: 'mv-reason' }, [el('option', { value: '', text: 'Kies een reden…' })]);
  const notitie = el('input', { type: 'text', id: 'mv-note', maxlength: '200', placeholder: 'bv. twee bakken meegegeven' });
  const datum = el('input', { type: 'date', id: 'mv-date', value: today() });

  const vulProducten = () => {
    clear(product);
    const opLocatie = state.stock.filter((r) => String(r.location_id) === locatie.value);
    const lijst = opLocatie.length ? opLocatie : state.products.map((p) => ({ product_id: p.id, product_name: p.name, unit: p.unit }));
    const gezien = new Set();
    for (const r of lijst) {
      if (gezien.has(r.product_id)) continue;
      gezien.add(r.product_id);
      product.append(el('option', { value: String(r.product_id), text: r.product_name }));
    }
  };
  locatie.addEventListener('change', vulProducten);
  vulProducten();

  const vulRedenen = () => {
    clear(reden);
    reden.append(el('option', { value: '', text: 'Kies een reden…' }));
    const uit = richting.value === '-1';
    for (const r of state.reasons.filter((x) => x.active && (x.direction === 'beide' || (uit ? x.direction === 'uit' : x.direction === 'in')))) {
      reden.append(el('option', { value: String(r.id), text: r.name }));
    }
  };
  richting.addEventListener('change', vulRedenen);
  vulRedenen();

  const boek = el('button', { class: 'btn', text: 'Boeken' });
  boek.addEventListener('click', async () => {
    const hoeveel = num(aantal.value, 0);
    if (!hoeveel || hoeveel <= 0) return toast('Vul een aantal in.', true);
    if (!reden.value) return toast('Kies een reden, anders weet niemand later waar het naartoe ging.', true);
    boek.disabled = true;
    try {
      await api('/api/moves', {
        method: 'POST',
        body: {
          location_id: num(locatie.value, null), product_id: num(product.value, null),
          qty: hoeveel * Number(richting.value), reason_id: num(reden.value, null),
          note: notitie.value, moved_on: datum.value,
        },
      });
      toast('Beweging geboekt.');
      aantal.value = '';
      notitie.value = '';
      await laadStock();
      render();
    } catch (err) { toast(err.message, true); } finally { boek.disabled = false; }
  });

  formVelden = { locatie, product, richting, aantal, reden, vulProducten };

  return el('details', { class: 'card', id: 'beweging', open: false }, [
    el('summary', {}, [el('b', { text: 'Drank uit de stock nemen of toevoegen' })]),
    el('p', { class: 'small muted mt-1', text: 'Voor wat niet via een telling of een levering gaat: drank voor het Rode Kruis, voor de bussen, breuk, personeel. De reden komt in de tijdlijn te staan.' }),
    state.reasons.filter((r) => r.active).length ? null : el('div', { class: 'notice notice--warn', text: 'Er zijn nog geen redenen ingesteld. Voeg ze toe bij Beheer → Redenen.' }),
    el('div', { class: 'row mt-2 align-end' }, [
      el('div', { class: 'f-field' }, [el('label', { for: 'mv-loc', text: 'Locatie' }), locatie]),
      el('div', { class: 'f-field-wide' }, [el('label', { for: 'mv-prod', text: 'Product' }), product]),
      el('div', { class: 'f-field' }, [el('label', { for: 'mv-dir', text: 'Richting' }), richting]),
      el('div', { class: 'f-field' }, [el('label', { for: 'mv-qty', text: 'Aantal' }), aantal]),
      el('div', { class: 'f-field' }, [el('label', { for: 'mv-reason', text: 'Reden' }), reden]),
      el('div', { class: 'f-field-wide' }, [el('label', { for: 'mv-note', text: 'Notitie' }), notitie]),
      el('div', { class: 'f-field' }, [el('label', { for: 'mv-date', text: 'Datum' }), datum]),
      el('div', { class: 'f-fixed' }, [boek]),
    ]),
  ]);
}

/* ---------------- de stocklijst ---------------- */

async function laadStock() {
  const res = await api(`/api/stock?company_id=${state.companyId}${state.locationId ? `&location_id=${state.locationId}` : ''}`);
  state.stock = res.stock || [];
}

function stockTabel(rijen) {
  const body = rijen.map((r) => {
    const boekKnop = el('button', { class: 'btn btn--sm btn--ghost', text: 'Boeken' });
    boekKnop.addEventListener('click', () => {
      const vouw = qs('#beweging');
      if (vouw) vouw.open = true;
      if (formVelden) {
        formVelden.locatie.value = String(r.location_id);
        formVelden.vulProducten();
        formVelden.product.value = String(r.product_id);
        formVelden.aantal.focus();
      }
      if (vouw) vouw.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return el('tr', {}, [
      el('td', {}, [
        el('b', { text: r.product_name }),
        el('div', { class: 'small muted', text: `${r.supplier_name || 'Zonder leverancier'} · laatst geteld ${dateNl(r.counted_on)}` }),
      ]),
      el('td', { class: 'num', text: fmt(r.geteld) }),
      el('td', { class: 'num' }, [
        fmt(r.geleverd),
        r.besteld_niet_geleverd ? el('div', { class: 'small' }, [el('span', { class: 'tag tag--sun', text: `${fmt(r.besteld_niet_geleverd)} besteld` })]) : null,
      ]),
      el('td', { class: 'num' }, [r.bewegingen
        ? el('b', { class: r.bewegingen > 0 ? 'ok' : 'bad', text: `${r.bewegingen > 0 ? '+' : ''}${fmt(r.bewegingen)}` })
        : el('span', { class: 'muted', text: '—' })]),
      el('td', { class: 'num', text: r.verkocht ? `−${fmt(r.verkocht)}` : '—' }),
      el('td', { class: 'num' }, [el('b', { class: r.nu < 0 ? 'bad' : '', text: `${fmt(r.nu)} ${r.unit}` })]),
      el('td', {}, [el('div', { class: 'row' }, [
        el('a', { class: 'btn btn--sm btn--ghost', href: `/stock?location_id=${r.location_id}&product_id=${r.product_id}`, text: 'Tijdlijn' }),
        boekKnop,
      ])]),
    ]);
  });

  return el('div', { class: 'table-wrap' }, [el('table', {}, [
    el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Product' }),
      el('th', { class: 'num', text: 'Geteld' }), el('th', { class: 'num', text: 'Geleverd' }),
      el('th', { class: 'num', text: 'Bewegingen' }), el('th', { class: 'num', text: 'Verkocht' }),
      el('th', { class: 'num', text: 'Nu in huis' }), el('th', { text: '' }),
    ])]),
    el('tbody', {}, body),
  ])]);
}

function render() {
  const content = clear(qs('#content'));
  content.append(el('h1', { text: 'Stock' }));

  const kiezer = el('select', { id: 'stock-loc' }, [
    el('option', { value: '', text: 'Alle locaties' }),
    ...state.locations.map((l) => el('option', { value: String(l.id), text: l.name })),
  ]);
  kiezer.value = state.locationId ? String(state.locationId) : '';
  kiezer.addEventListener('change', async () => {
    state.locationId = num(kiezer.value, null);
    await laadStock();
    render();
  });
  const zoek = el('input', { type: 'search', id: 'stock-zoek', placeholder: 'product of leverancier', value: state.zoek });
  zoek.addEventListener('input', () => { state.zoek = zoek.value; teken(); });

  content.append(el('section', { class: 'card' }, [
    el('p', { class: 'small muted', text: 'Wat er nu in huis zou moeten zijn: de laatste telling, plus wat er geleverd is, plus of min de geboekte bewegingen, min wat er sindsdien verkocht is.' }),
    el('div', { class: 'row mt-2 align-end' }, [
      el('div', { class: 'f-field' }, [el('label', { for: 'stock-loc', text: 'Locatie' }), kiezer]),
      el('div', { class: 'f-field-wide' }, [el('label', { for: 'stock-zoek', text: 'Zoeken' }), zoek]),
    ]),
  ]));
  content.append(bewegingsForm());

  const lijst = el('div', {});
  content.append(lijst);

  const teken = () => {
    clear(lijst);
    const term = state.zoek.trim().toLowerCase();
    const rijen = state.stock.filter((r) => !term || `${r.product_name} ${r.supplier_name || ''}`.toLowerCase().includes(term));
    if (!rijen.length) {
      lijst.append(el('div', { class: 'notice', text: state.stock.length ? 'Geen producten gevonden.' : 'Er is nog niets geteld, dus over de stock valt nog niets te zeggen.' }));
      return;
    }
    const perLocatie = new Map();
    for (const r of rijen) {
      if (!perLocatie.has(r.location_id)) perLocatie.set(r.location_id, []);
      perLocatie.get(r.location_id).push(r);
    }
    for (const [, rows] of perLocatie) {
      lijst.append(el('section', { class: 'card' }, [
        el('div', { class: 'card__head' }, [
          el('h2', { text: rows[0].location_name }),
          el('span', { class: 'muted small', text: plural(rows.length, 'product', 'producten') }),
        ]),
        stockTabel(rows),
      ]));
    }
  };
  teken();
}

async function init() {
  const header = await mountHeader('stock');
  state.companyId = header.companyId;
  state.canManage = header.canManage;
  if (!state.companyId) throw new Error('Er is nog geen bedrijf ingesteld.');

  state.locationId = num(params().get('location_id'), null);
  const productId = num(params().get('product_id'), null);

  // met all=1 komen ook de producten mee, zodat er geboekt kan worden op een product dat op
  // die toog nog nooit geteld is
  const catalogus = await api(`/api/catalog?company_id=${state.companyId}&all=1`);
  state.locations = (catalogus.locations || []).filter((l) => l.active);
  state.products = (catalogus.products || []).filter((p) => p.active !== 0);

  if (productId && state.locationId) return toonTijdlijn(state.locationId, productId);

  const [redenen] = await Promise.all([
    api(`/api/admin/reasons?company_id=${state.companyId}`).catch(() => ({ reasons: [] })),
    laadStock(),
  ]);
  state.reasons = redenen.reasons || [];
  render();
}

init().catch((err) => {
  clear(qs('#content'));
  qs('#messages').replaceChildren(el('div', { class: 'notice notice--error', text: err.message }));
});
