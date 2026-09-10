// Overzicht van de dag: waar is er geteld, wat moet er nog besteld worden, en wat is er
// besteld maar nog niet nagekeken.
import { api, fmt, el, clear, qs, mountHeader, dateNl, plural } from './app.js';

let header = null;

const card = (title, ...children) => el('section', { class: 'card' }, [
  el('div', { class: 'card__head' }, [el('h2', { text: title })]),
  ...children.filter(Boolean),
]);

/** Kort kengetal: één cijfer met zijn onderschrift. */
const stat = (value, label, tone = '') => el('div', { class: `kpi${tone ? ` kpi--${tone}` : ''}` }, [
  el('b', { class: 'kpi__value', text: String(value) }),
  el('span', { class: 'kpi__label', text: label }),
]);

function tellingen(data) {
  const rows = data.locations.map((l) => {
    const laat = !l.counted_on || l.counted_on < data.today;
    return el('tr', {}, [
      el('td', { text: l.name }),
      el('td', { text: l.counted_on ? dateNl(l.counted_on) : 'nog nooit' }),
      el('td', {}, [l.count_id
        ? el('span', { class: l.status === 'open' ? 'tag tag--sun' : 'tag tag--mint', text: l.status })
        : el('span', { class: 'muted', text: '—' })]),
      el('td', {}, [l.count_id
        ? el('a', { class: 'btn btn--sm btn--ghost', href: `/bestelling?id=${l.count_id}`, text: 'Bekijken' })
        : null,
        el('a', { class: 'btn btn--sm btn--ghost', href: `/?location=${l.id}`, text: laat ? 'Tellen' : 'Opnieuw tellen' })]),
    ]);
  });
  return card('Tellingen per locatie',
    el('div', { class: 'table-wrap' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Locatie' }), el('th', { text: 'Laatst geteld' }),
        el('th', { text: 'Status' }), el('th', { text: '' }),
      ])]),
      el('tbody', {}, rows),
    ])]));
}

function teBestellen(data) {
  if (!data.to_order.length) {
    return card(`Vandaag te bestellen (${dateNl(data.today)})`,
      el('p', { class: 'muted', text: 'Uit de tellingen van vandaag volgt voorlopig geen bestelling.' }));
  }
  const blokken = data.to_order.map((g) => el('div', { class: 'mt-2' }, [
    el('h3', { text: `${g.supplier_name} · ${fmt(g.units)} eenheden` }),
    el('ul', { class: 'small columns' }, g.lines.map((l) => el('li', {
      text: Number(l.pack_size) > 1
        ? `${l.product_name} — ${fmt(l.order_packs)} × ${fmt(l.pack_size)} ${l.unit}`
        : `${l.product_name} — ${fmt(l.order_qty)} ${l.unit}`,
    }))),
  ]));
  return card(`Vandaag te bestellen (${dateNl(data.today)})`,
    el('p', { class: 'small muted', text: 'Opgeteld over alle tellingen van vandaag die nog op open staan.' }),
    ...blokken,
    el('div', { class: 'row mt-2' }, [
      el('a', { class: 'btn', href: `/api/export/xlsx?company_id=${data.company.id}&date=${data.today}`, text: 'Bestellijst van vandaag (Excel)' }),
    ]));
}

/** Wat er nu in huis staat, per toog, met een doorklik naar de stock zelf. */
function stockOverzicht(data) {
  if (!data.stock.length) return null;
  const rijen = data.stock.map((l) => el('tr', {}, [
    el('td', {}, [el('a', { href: `/stock?location_id=${l.location_id}`, text: l.location_name })]),
    el('td', { text: dateNl(l.counted_on) }),
    el('td', { class: 'num', text: String(l.producten) }),
    el('td', { class: 'num' }, [l.onder_basis
      ? el('b', { class: 'warn', text: String(l.onder_basis) })
      : el('span', { class: 'muted', text: '0' })]),
    el('td', { class: 'num' }, [l.leeg
      ? el('b', { class: 'bad', text: String(l.leeg) })
      : el('span', { class: 'muted', text: '0' })]),
  ]));
  return card('Stock nu',
    el('p', { class: 'small muted', text: 'De laatste telling, plus wat er geleverd is, plus of min de geboekte bewegingen, min wat er sindsdien verkocht is. Klik op een toog voor de details en de tijdlijn per product.' }),
    el('div', { class: 'table-wrap mt-2' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Toog' }), el('th', { text: 'Laatst geteld' }),
        el('th', { class: 'num', text: 'Producten' }), el('th', { class: 'num', text: 'Onder basis' }),
        el('th', { class: 'num', text: 'Leeg' }),
      ])]),
      el('tbody', {}, rijen),
    ])]),
    el('div', { class: 'row mt-2' }, [el('a', { class: 'btn btn--ghost', href: '/stock', text: 'Naar de stock' })]));
}

/** De laatste handmatige bewegingen: drank die zonder telling of levering wegging of bijkwam. */
function bewegingen(data) {
  if (!data.moves || !data.moves.length) return null;
  return card('Laatste stockbewegingen',
    el('ul', { class: 'small' }, data.moves.map((m) => el('li', {
      text: `${dateNl(m.moved_on)} · ${m.location_name} · ${m.product_name}: ${m.qty > 0 ? '+' : ''}${fmt(m.qty)} ${m.unit || 'stuk'}`
        + ` — ${m.reason_name || 'handmatige aanpassing'}${m.note ? ` (${m.note})` : ''}`,
    }))));
}

function leveringen(data) {
  if (!data.open_orders.length) return null;
  const rows = data.open_orders.map((o) => el('tr', {}, [
    el('td', { text: o.location_name }),
    el('td', { text: dateNl(o.counted_on) }),
    el('td', { class: 'num', text: plural(o.order_lines, 'regel', 'regels') }),
    el('td', {}, [el('a', { class: 'btn btn--sm btn--secondary', href: `/ontvangst?id=${o.id}`, text: 'Levering inboeken' })]),
  ]));
  return card('Besteld, nog niet nagekeken',
    el('div', { class: 'table-wrap' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Locatie' }), el('th', { text: 'Telling van' }),
        el('th', { class: 'num', text: 'Bestelregels' }), el('th', { text: '' }),
      ])]),
      el('tbody', {}, rows),
    ])]));
}

function verschillen(data) {
  if (!data.differences.length) return null;
  return card('Leveringen die niet klopten',
    el('ul', { class: 'small' }, data.differences.map((d) => el('li', {
      text: `${dateNl(d.counted_on)} · ${d.location_name} · ${d.product_name}: besteld ${fmt(d.order_qty)}, `
        + `geleverd ${fmt(d.received_qty)} (${d.diff > 0 ? '+' : ''}${fmt(d.diff)} ${d.unit})`,
    }))));
}

function kop(data) {
  const open = data.counted_today.filter((c) => c.status === 'open').length;
  const regels = data.to_order.reduce((a, g) => a + g.lines.length, 0);
  return el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [el('h1', { text: `Overzicht ${data.company.name}` })]),
    el('p', { class: 'muted small', text: dateNl(data.today) }),
    el('div', { class: 'kpis mt-2' }, [
      stat(`${data.counted_today.length}/${data.locations.length}`, 'locaties vandaag geteld'),
      stat(regels, 'producten te bestellen', regels ? 'sun' : ''),
      stat(open, 'tellingen nog open'),
      stat(data.open_orders.length, 'leveringen na te kijken', data.open_orders.length ? 'sun' : ''),
    ]),
    data.not_counted_today.length
      ? el('p', { class: 'small mt-2' }, [
          el('b', { text: 'Nog te tellen: ' }),
          data.not_counted_today.map((l) => l.name).join(', '),
        ])
      : el('p', { class: 'small mt-2', text: 'Alle locaties zijn vandaag geteld.' }),
    data.warnings.length
      ? el('div', { class: 'notice notice--warn mt-2' }, [el('ul', {}, data.warnings.map((w) => el('li', { text: w })))])
      : null,
  ]);
}

async function load() {
  const data = await api(`/api/dashboard${header.companyId ? `?company_id=${header.companyId}` : ''}`);
  const content = clear(qs('#content'));
  content.append(kop(data), teBestellen(data));
  for (const blok of [stockOverzicht(data), leveringen(data), verschillen(data), bewegingen(data), tellingen(data)]) {
    if (blok) content.append(blok);
  }
}

async function init() {
  header = await mountHeader('dashboard');
  await load();
}

init().catch((err) => {
  clear(qs('#content'));
  qs('#messages').replaceChildren(el('div', { class: 'notice notice--error' }, [err.message]));
});
