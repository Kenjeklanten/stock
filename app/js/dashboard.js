// Overzicht van de dag. Drie vragen, niet meer:
//   1. waar moet nog geteld worden?
//   2. wat moet er besteld worden?
//   3. welke leveringen moeten nagekeken worden?
//
// Wat hier vroeger ook stond, staat nu waar het hoort: de stand van de stock en de laatste
// bewegingen op /stock, de afwijkingen bij een levering op /leveringen, en wat er scheef staat
// in de catalogus bij Beheer. Dit scherm wordt elke dag opnieuw bekeken; alles wat er staat
// hoort iets te zijn waar je vandaag iets mee doet.
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

function kop(data) {
  const teTellen = data.not_counted_today.length;
  return el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [
      el('h1', { text: `Overzicht ${data.company.name}` }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'small muted', text: dateNl(data.today) }),
    ]),
    el('div', { class: 'kpis' }, [
      stat(teTellen, 'togen nog te tellen', teTellen ? 'sun' : ''),
      stat(data.open_orders.length, 'leveringen na te kijken', data.open_orders.length ? 'sun' : ''),
    ]),
    teTellen
      ? el('p', { class: 'small mt-2' }, [
          el('b', { text: 'Nog te tellen: ' }),
          data.not_counted_today.map((l) => l.name).join(', '),
        ])
      : el('p', { class: 'small mt-2', text: 'Alle togen zijn vandaag geteld.' }),
  ]);
}

/** Wat er vandaag nog besteld moet worden, opgeteld over de open tellingen van vandaag. */
function teBestellen(data) {
  if (!data.to_order.length) {
    return card('Vandaag te bestellen',
      el('p', { class: 'muted', text: 'Er staat vandaag niets te bestellen.' }));
  }
  const blokken = data.to_order.map((g) => el('div', { class: 'mt-2' }, [
    el('h3', { text: `${g.supplier_name} · ${plural(g.lines.length, 'regel', 'regels')}` }),
    el('ul', { class: 'small columns' }, g.lines.map((l) => el('li', {
      text: `${l.product_name} — ${Number(l.pack_size) > 1
        ? `${fmt(l.order_packs)} × ${fmt(l.pack_size)} ${l.unit}`
        : `${fmt(l.order_qty)} ${l.unit}`}`,
    }))),
  ]));
  return card('Vandaag te bestellen',
    el('p', { class: 'small muted', text: 'Opgeteld over alle tellingen van vandaag die nog op open staan.' }),
    ...blokken,
    el('div', { class: 'row mt-2' }, [
      el('a', {
        class: 'btn',
        href: `/api/export/xlsx?company_id=${data.company.id}&date=${data.today}`,
        text: 'Bestellijst van vandaag (Excel)',
      }),
    ]));
}

/** Hoever staat het nakijken van deze bestelling? */
function stand(o) {
  if (o.checked_lines >= o.order_lines) return el('span', { class: 'tag tag--mint', text: 'alles nagekeken' });
  if (o.checked_lines) return el('span', { class: 'tag tag--sun', text: `${o.checked_lines} van ${o.order_lines} nagekeken` });
  if (o.status === 'besteld') {
    return el('span', { class: 'tag tag--sun', text: o.ordered_at ? `besteld op ${dateNl(o.ordered_at.slice(0, 10))}` : 'besteld' });
  }
  return el('span', { class: 'muted', text: 'nog niet als besteld gemarkeerd' });
}

function leveringen(data) {
  if (!data.open_orders.length) return null;
  const rows = data.open_orders.map((o) => el('tr', {}, [
    el('td', {}, [el('a', { href: `/bestelling?id=${o.id}`, text: o.location_name })]),
    el('td', { text: dateNl(o.counted_on) }),
    el('td', { class: 'num', text: plural(o.order_lines, 'regel', 'regels') }),
    el('td', {}, [stand(o)]),
    el('td', {}, [el('a', {
      class: 'btn btn--sm btn--secondary',
      href: `/ontvangst?id=${o.id}`,
      text: o.checked_lines ? 'Verder inboeken' : 'Levering inboeken',
    })]),
  ]));
  return card('Leveringen om na te kijken',
    el('div', { class: 'table-wrap' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Locatie' }), el('th', { text: 'Telling van' }),
        el('th', { class: 'num', text: 'Bestelregels' }), el('th', { text: 'Stand' }), el('th', { text: '' }),
      ])]),
      el('tbody', {}, rows),
    ])]),
    el('div', { class: 'row mt-2' }, [el('a', { class: 'btn btn--ghost', href: '/leveringen', text: 'Alle leveringen' })]));
}

async function load() {
  const data = await api(`/api/dashboard${header.companyId ? `?company_id=${header.companyId}` : ''}`);
  const content = clear(qs('#content'));
  content.append(kop(data), teBestellen(data));
  const nakijken = leveringen(data);
  if (nakijken) content.append(nakijken);
}

async function init() {
  header = await mountHeader('dashboard');
  await load();
}

init().catch((err) => {
  clear(qs('#content'));
  qs('#messages').replaceChildren(el('div', { class: 'notice notice--error' }, [err.message]));
});
