// Verkoop uit de kassa naast de voorraad leggen: inlezen, de kassanamen koppelen aan producten
// en togen, en dan het verschil bekijken tussen wat er verdwenen is en wat er verkocht is.
import { api, toast, fmt, num, el, clear, qs, qsa, mountHeader, dateNl, today, plural } from './app.js';
import { readWorkbook, interpretVerkoop } from './xlsx-read.js';

const state = {
  companyId: null, canManage: false, tab: 'rapporten',
  imports: [], report: null, reportId: null,
  mapping: null, bestand: null,
};

const euro = (n) => (n === null || n === undefined ? '—' : `€ ${fmt(Math.round(Number(n) * 100) / 100)}`);

/* ---------------- rapporten en het verschil ---------------- */

async function laadRapporten() {
  const res = await api(`/api/sales?company_id=${state.companyId}`);
  state.imports = res.imports || [];
}

async function toonRapport(id) {
  state.reportId = id;
  state.report = null;
  render();
  try {
    state.report = await api(`/api/sales/${id}`);
  } catch (err) {
    toast(err.message, true);
  }
  render();
}

function rapportenLijst(panel) {
  if (!state.imports.length) {
    panel.append(el('div', { class: 'notice' }, [
      'Er is nog geen verkoop ingelezen. ',
      el('button', { class: 'linkish', text: 'Lees een kassarapport in', onclick: () => { state.tab = 'inlezen'; render(); } }), '.',
    ]));
    return;
  }
  const rows = state.imports.map((i) => el('tr', {}, [
    el('td', {}, [el('b', { text: i.label })]),
    el('td', { text: dateNl(i.sold_on) }),
    el('td', { class: 'num', text: fmt(i.items || 0) }),
    el('td', {}, [
      el('button', { class: 'btn btn--sm', text: 'Verschil bekijken', onclick: () => toonRapport(i.id) }),
      state.canManage ? el('button', {
        class: 'btn btn--sm btn--danger', text: 'Wis',
        onclick: async () => {
          if (!confirm(`"${i.label}" van ${dateNl(i.sold_on)} verwijderen?`)) return;
          try {
            await api(`/api/sales/${i.id}`, { method: 'DELETE' });
            if (state.reportId === i.id) { state.reportId = null; state.report = null; }
            await laadRapporten();
            render();
          } catch (err) { toast(err.message, true); }
        },
      }) : null,
    ]),
  ]));

  panel.append(el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [el('h2', { text: 'Ingelezen verkoop' })]),
    el('div', { class: 'table-wrap' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Rapport' }), el('th', { text: 'Verkoopdag' }),
        el('th', { class: 'num', text: 'Stuks' }), el('th', { text: '' }),
      ])]),
      el('tbody', {}, rows),
    ])]),
  ]));

  if (state.reportId && !state.report) {
    panel.append(el('p', { class: 'skeleton', text: 'Verschil berekenen…' }));
  } else if (state.report) {
    verschilRapport(panel, state.report);
  }
}

function verschilRapport(panel, r) {
  const tekort = r.rows.filter((x) => x.verschil > 0.001);
  const teveel = r.rows.filter((x) => x.verschil < -0.001);

  panel.append(el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [el('h2', { text: `${r.import.label} — ${dateNl(r.import.sold_on)}` })]),
    el('div', { class: 'kpis mt-2' }, [
      el('div', { class: 'kpi' }, [el('b', { class: 'kpi__value', text: euro(r.totals.omzet) }), el('span', { class: 'kpi__label', text: 'omzet in de kassa' })]),
      el('div', { class: `kpi${r.totals.verschil_waarde > 0 ? ' kpi--sun' : ''}` }, [
        el('b', { class: 'kpi__value', text: euro(r.totals.verschil_waarde) }),
        el('span', { class: 'kpi__label', text: 'weg zonder verkoop' }),
      ]),
      el('div', { class: 'kpi' }, [el('b', { class: 'kpi__value', text: String(tekort.length) }), el('span', { class: 'kpi__label', text: 'producten met een tekort' })]),
      el('div', { class: 'kpi' }, [el('b', { class: 'kpi__value', text: String(teveel.length) }), el('span', { class: 'kpi__label', text: 'producten met een overschot' })]),
    ]),
    el('p', { class: 'small muted mt-2', text: 'Verbruik = geteld vóór de wedstrijd + wat er toen geleverd is − geteld erna. Verschil = verbruik − verkocht. Een tekort is wat er weg is zonder aan de kassa te passeren; een overschot wijst meestal op een telfout of een koppeling die niet klopt.' }),
  ]));

  if (r.unmapped_articles.length || r.unmapped_locations.length) {
    panel.append(el('div', { class: 'notice notice--warn' }, [
      el('b', { text: 'Nog niet alles is gekoppeld. ' }),
      r.unmapped_articles.length ? `${plural(r.unmapped_articles.length, 'artikel', 'artikelen')} (${r.unmapped_articles.slice(0, 5).map((a) => a.name).join(', ')}${r.unmapped_articles.length > 5 ? ', …' : ''}) ` : '',
      r.unmapped_locations.length ? `en ${plural(r.unmapped_locations.length, 'toog', 'togen')} (${r.unmapped_locations.map((l) => l.name).join(', ')}) ` : '',
      'tellen nog niet mee. ',
      el('button', { class: 'linkish', text: 'Koppelen', onclick: () => { state.tab = 'koppelen'; render(); } }), '.',
    ]));
  }
  if (r.warnings.length) {
    panel.append(el('div', { class: 'notice' }, [
      el('b', { text: 'Let op' }),
      el('ul', {}, r.warnings.slice(0, 12).map((w) => el('li', { text: w }))),
    ]));
  }
  if (!r.rows.length) return;

  const rij = (x) => el('tr', {}, [
    el('td', { text: x.location_name }),
    el('td', {}, [el('b', { text: x.product_name })]),
    el('td', { class: 'num', text: fmt(x.begin) }),
    el('td', { class: 'num' }, [
      fmt(x.geleverd),
      x.geleverd_nagekeken ? null : el('span', { class: 'tag tag--sun', text: 'besteld' }),
    ]),
    el('td', { class: 'num', text: fmt(x.eind) }),
    el('td', { class: 'num', text: `${fmt(x.verbruikt)} ${x.unit}` }),
    el('td', { class: 'num', text: `${fmt(x.verkocht)} ${x.unit}` }),
    el('td', { class: 'num' }, [el('b', { class: x.verschil > 0.001 ? 'bad' : (x.verschil < -0.001 ? 'warn' : 'ok'), text: fmt(x.verschil) })]),
    el('td', { class: 'num', text: euro(x.waarde) }),
  ]);

  panel.append(el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [el('h2', { text: 'Per toog en product' })]),
    el('div', { class: 'table-wrap' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Toog' }), el('th', { text: 'Product' }),
        el('th', { class: 'num', text: 'Begin' }), el('th', { class: 'num', text: 'Geleverd' }), el('th', { class: 'num', text: 'Eind' }),
        el('th', { class: 'num', text: 'Verbruik' }), el('th', { class: 'num', text: 'Verkocht' }),
        el('th', { class: 'num', text: 'Verschil' }), el('th', { class: 'num', text: 'Waarde' }),
      ])]),
      el('tbody', {}, r.rows.map(rij)),
    ])]),
  ]));
}

/* ---------------- inlezen ---------------- */

function inlezen(panel) {
  const bestand = el('input', { type: 'file', accept: '.xlsx,.xls', id: 'sales-file' });
  const label = el('input', { type: 'text', id: 'sales-label', placeholder: 'bv. Speeldag 10' });
  const datum = el('input', { type: 'date', id: 'sales-date', value: today() });
  const uitslag = el('div', { class: 'mt-2' });
  const knop = el('button', { class: 'btn', text: 'Inlezen', disabled: true });

  bestand.addEventListener('change', async () => {
    const file = bestand.files && bestand.files[0];
    state.bestand = null;
    knop.disabled = true;
    clear(uitslag);
    if (!file) return;
    uitslag.append(el('p', { class: 'skeleton', text: 'Bestand lezen…' }));
    try {
      const gelezen = interpretVerkoop(await readWorkbook(file));
      clear(uitslag);
      if (!gelezen) {
        uitslag.append(el('div', { class: 'notice notice--error', text: 'In dit bestand vind ik geen verkooptabel. Verwacht wordt één blad met kolommen voor de toog ("Sales locations"), het artikel ("Products") en het aantal ("Quantity (total)").' }));
        return;
      }
      state.bestand = gelezen;
      if (!label.value.trim()) label.value = file.name.replace(/\.[^.]+$/, '');
      uitslag.append(el('div', { class: 'notice notice--ok' }, [
        el('b', { text: `${plural(gelezen.rows.length, 'regel', 'regels')} gelezen` }),
        ` uit blad "${gelezen.sheet}": ${fmt(gelezen.items)} stuks, ${euro(gelezen.revenue)} omzet, `,
        `${plural(gelezen.locations.length, 'toog', 'togen')} en ${plural(gelezen.articles.length, 'artikel', 'artikelen')}.`,
        gelezen.skippedTotal ? el('p', { class: 'small mt-1', text: 'De totaalregel onderaan het bestand is overgeslagen.' }) : null,
      ]));
      knop.disabled = false;
    } catch (err) {
      clear(uitslag);
      uitslag.append(el('div', { class: 'notice notice--error', text: `Dit bestand lezen lukte niet: ${err.message}` }));
    }
  });

  knop.addEventListener('click', async () => {
    if (!state.bestand) return;
    knop.disabled = true;
    try {
      const res = await api('/api/sales', {
        method: 'POST',
        body: { company_id: state.companyId, label: label.value, sold_on: datum.value, rows: state.bestand.rows },
      });
      toast(`${plural(res.lines, 'regel', 'regels')} ingelezen.`);
      state.bestand = null;
      bestand.value = '';
      await laadRapporten();
      state.mapping = null;
      // meteen naar het koppelscherm als er nog namen open staan, anders naar het verschil
      const map = await api(`/api/admin/sales-mapping?company_id=${state.companyId}`);
      state.mapping = map;
      const open = map.articles.filter((a) => !a.mapped).length + map.sales_locations.filter((l) => !l.mapped).length;
      state.tab = open ? 'koppelen' : 'rapporten';
      if (!open) await toonRapport(res.id); else render();
    } catch (err) {
      toast(err.message, true);
      knop.disabled = false;
    }
  });

  panel.append(el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [el('h2', { text: 'Kassarapport inlezen' })]),
    el('p', { class: 'small muted', text: 'Het Excel-bestand met de verkoop per toog, zoals de kassa het uitvoert. Eén bestand is één verkoopdag; de datum bepaalt tussen welke twee tellingen het verschil berekend wordt.' }),
    el('div', { class: 'row mt-2 align-end' }, [
      el('div', { class: 'f-field-wide' }, [el('label', { for: 'sales-file', text: 'Bestand' }), bestand]),
      el('div', { class: 'f-field' }, [el('label', { for: 'sales-label', text: 'Naam' }), label]),
      el('div', { class: 'f-field' }, [el('label', { for: 'sales-date', text: 'Verkoopdag' }), datum]),
    ]),
    uitslag,
    el('div', { class: 'mt-2' }, [knop]),
  ]));
}

/* ---------------- koppelen ---------------- */

async function laadKoppelingen() {
  state.mapping = await api(`/api/admin/sales-mapping?company_id=${state.companyId}`);
}

function koppelen(panel) {
  const m = state.mapping;
  if (!m) { panel.append(el('p', { class: 'skeleton', text: 'Laden…' })); return; }
  if (!m.articles.length) {
    panel.append(el('div', { class: 'notice', text: 'Er is nog geen verkoop ingelezen, dus er valt nog niets te koppelen.' }));
    return;
  }

  const artikelVelden = new Map();
  const locatieVelden = new Map();

  const productKeuze = (gekozen) => {
    const s = el('select', {}, [
      el('option', { value: '', text: 'Kies een product…' }),
      ...m.products.map((p) => el('option', { value: String(p.id), text: p.name })),
    ]);
    s.value = gekozen ? String(gekozen) : '';
    return s;
  };

  const artikelRij = (a) => {
    const voorstel = a.suggestion;
    const product = productKeuze(a.product_id || (voorstel && voorstel.product_id));
    const factor = el('input', {
      type: 'number', min: '0', step: 'any', class: 'f-num',
      value: a.units_per_sale !== null && a.units_per_sale !== undefined
        ? String(a.units_per_sale) : String((voorstel && voorstel.units_per_sale) || 1),
      'aria-label': `Voorraadeenheden per verkocht stuk voor ${a.name}`,
    });
    const negeer = el('input', { type: 'checkbox', 'aria-label': `${a.name} telt niet mee` });
    negeer.checked = !!a.ignored;
    artikelVelden.set(a.name, { product, factor, negeer });

    return el('tr', {}, [
      el('td', {}, [
        el('b', { text: a.name }),
        el('div', { class: 'small muted', text: `${fmt(a.qty)} verkocht · ${euro(a.revenue)}` }),
      ]),
      el('td', {}, [product,
        voorstel && !a.mapped ? el('div', { class: 'small muted', text: `voorstel: ${voorstel.uitleg}` }) : null]),
      el('td', {}, [factor]),
      el('td', { class: 'center' }, [negeer]),
      el('td', {}, [a.mapped ? el('span', { class: 'tag tag--mint', text: 'gekoppeld' })
        : (voorstel ? el('span', { class: voorstel.zeker ? 'tag' : 'tag tag--sun', text: voorstel.zeker ? 'voorstel' : 'nakijken' })
          : el('span', { class: 'tag tag--danger', text: 'onbekend' }))]),
    ]);
  };

  const locatieRij = (l) => {
    const keuze = el('select', {}, [
      el('option', { value: '', text: 'Kies een toog…' }),
      ...m.locations.map((x) => el('option', { value: String(x.id), text: x.name })),
    ]);
    keuze.value = String(l.location_id || (l.suggestion && l.suggestion.location_id) || '');
    const negeer = el('input', { type: 'checkbox', 'aria-label': `${l.name} telt niet mee` });
    negeer.checked = !!l.ignored;
    locatieVelden.set(l.name, { keuze, negeer });
    return el('tr', {}, [
      el('td', {}, [el('b', { text: l.name }), el('div', { class: 'small muted', text: `${fmt(l.qty)} verkocht` })]),
      el('td', {}, [keuze]),
      el('td', { class: 'center' }, [negeer]),
      el('td', {}, [l.mapped ? el('span', { class: 'tag tag--mint', text: 'gekoppeld' })
        : (l.suggestion ? el('span', { class: l.suggestion.zeker ? 'tag' : 'tag tag--sun', text: l.suggestion.zeker ? 'voorstel' : 'nakijken' })
          : el('span', { class: 'tag tag--danger', text: 'onbekend' }))]),
    ]);
  };

  const bewaar = el('button', { class: 'btn', text: 'Koppelingen bewaren' });
  bewaar.addEventListener('click', async () => {
    bewaar.disabled = true;
    try {
      const articles = [...artikelVelden.entries()]
        .filter(([, v]) => v.negeer.checked || v.product.value)
        .map(([name, v]) => ({ name, product_id: num(v.product.value, null), units_per_sale: num(v.factor.value, 1), ignored: v.negeer.checked }));
      const locations = [...locatieVelden.entries()]
        .filter(([, v]) => v.negeer.checked || v.keuze.value)
        .map(([name, v]) => ({ name, location_id: num(v.keuze.value, null), ignored: v.negeer.checked }));
      if (!articles.length && !locations.length) return toast('Er is nog niets ingevuld om te bewaren.', true);
      await api('/api/admin/sales-mapping', { method: 'POST', body: { company_id: state.companyId, articles, locations } });
      toast('Koppelingen bewaard. Ze gelden ook voor de rapporten die al ingelezen zijn.');
      await laadKoppelingen();
      if (state.reportId) state.report = await api(`/api/sales/${state.reportId}`).catch(() => state.report);
      render();
    } catch (err) {
      toast(err.message, true);
    } finally {
      bewaar.disabled = false;
    }
  });

  const openArtikelen = m.articles.filter((a) => !a.mapped).length;
  panel.append(
    el('section', { class: 'card' }, [
      el('div', { class: 'card__head' }, [el('h2', { text: 'Togen van de kassa' })]),
      el('p', { class: 'small muted', text: 'De kassa noemt een toog anders dan de voorraad. Meerdere kassatogen mogen naar dezelfde locatie wijzen; wat je niet in de voorraad telt, vink je af.' }),
      el('div', { class: 'table-wrap mt-2' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'In de kassa' }), el('th', { text: 'Locatie in de voorraad' }),
          el('th', { class: 'center', text: 'Telt niet mee' }), el('th', { text: '' }),
        ])]),
        el('tbody', {}, m.sales_locations.map(locatieRij)),
      ])]),
    ]),
    el('section', { class: 'card' }, [
      el('div', { class: 'card__head' }, [
        el('h2', { text: 'Artikelen van de kassa' }),
        openArtikelen ? el('span', { class: 'tag tag--sun', text: `${openArtikelen} nog te doen` }) : null,
      ]),
      el('p', { class: 'small muted', text: 'Per artikel: welk product gaat eruit, en hoeveel van dat product per verkocht stuk. Een glas van 30 cl uit een vat van 50 l is 0,006 vat; een flesje dat je ook per flesje telt is 1. Waarborg, testartikelen en dergelijke vink je af.' }),
      el('div', { class: 'table-wrap mt-2' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'In de kassa' }), el('th', { text: 'Product in de voorraad' }),
          el('th', { text: 'Per verkocht stuk' }), el('th', { class: 'center', text: 'Telt niet mee' }), el('th', { text: '' }),
        ])]),
        el('tbody', {}, m.articles.map(artikelRij)),
      ])]),
      el('div', { class: 'mt-2' }, [bewaar]),
    ]),
  );
}

/* ---------------- schermopbouw ---------------- */

const TABS = [
  ['rapporten', 'Verschil'],
  ['inlezen', 'Inlezen'],
  ['koppelen', 'Koppelingen'],
];

function render() {
  const content = clear(qs('#content'));
  content.append(el('h1', { text: 'Verkoop' }));
  content.append(el('div', { class: 'tabs', role: 'tablist' }, TABS.map(([id, naam]) => {
    const knop = el('button', { role: 'tab', text: naam, 'aria-selected': String(state.tab === id) });
    knop.addEventListener('click', async () => {
      state.tab = id;
      if (id === 'koppelen' && !state.mapping) { render(); await laadKoppelingen(); }
      render();
    });
    return knop;
  })));

  const panel = el('div', { id: 'panel' });
  content.append(panel);
  if (!state.companyId) {
    panel.append(el('div', { class: 'notice', text: 'Kies eerst een bedrijf.' }));
    return;
  }
  if (state.tab === 'rapporten') rapportenLijst(panel);
  if (state.tab === 'inlezen') inlezen(panel);
  if (state.tab === 'koppelen') koppelen(panel);
}

async function init() {
  const header = await mountHeader('verkoop');
  state.companyId = header.companyId;
  state.canManage = header.canManage;
  if (!state.canManage) {
    clear(qs('#content'));
    qs('#messages').replaceChildren(el('div', { class: 'notice', text: 'Voor de verkoopcijfers heb je beheerrechten nodig.' }));
    return;
  }
  await laadRapporten();
  render();
  if (state.imports.length) await toonRapport(state.imports[0].id);
}

init().catch((err) => {
  clear(qs('#content'));
  qs('#messages').replaceChildren(el('div', { class: 'notice notice--error', text: err.message }));
});
