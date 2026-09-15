// Leveringen: elke bestelling die uit een telling volgde, en of ze al nagekeken is.
//
// Dit is de ingang van de ontvangstcontrole. Wie de bestelling doorgegeven heeft, vindt ze hier
// terug zodra de bakken binnenkomen en vult in wat er effectief geleverd is.
import { api, el, clear, qs, mountHeader, dateNl, plural } from './app.js';

let companyId = null;

const card = (title, ...children) => el('section', { class: 'card' }, [
  el('div', { class: 'card__head' }, [el('h2', { text: title })]),
  ...children.filter(Boolean),
]);

/** Hoe ver staat het nakijken van deze bestelling? */
function voortgang(d) {
  if (!d.checked_lines) return el('span', { class: 'muted', text: 'nog niet begonnen' });
  if (d.checked_lines < d.order_lines) {
    return el('span', { class: 'tag tag--sun', text: `${d.checked_lines} van ${d.order_lines} nagekeken` });
  }
  return el('span', { class: 'tag tag--mint', text: 'alles nagekeken' });
}

/** Klopte de levering? Pas te zeggen als er iets ingevuld is. */
function afwijking(d) {
  if (!d.checked_lines) return el('span', { class: 'muted', text: '—' });
  if (!d.diff_lines) return el('span', { class: 'tag tag--mint', text: 'klopt' });
  return el('span', { class: 'tag tag--danger', text: plural(d.diff_lines, 'afwijking', 'afwijkingen') });
}

const besteldTekst = (d) => (d.status === 'besteld' && d.ordered_at
  ? `besteld op ${dateNl(d.ordered_at.slice(0, 10))}`
  : 'nog niet als besteld gemarkeerd');

function openRow(d) {
  return el('tr', {}, [
    el('td', {}, [
      el('a', { href: `/bestelling?id=${d.id}`, text: d.location_name }),
      el('div', { class: 'muted small', text: `telling ${d.id} · ${dateNl(d.counted_on)} · ${besteldTekst(d)}` }),
    ]),
    el('td', { class: 'num', text: plural(d.order_lines, 'regel', 'regels') }),
    el('td', { class: 'num', text: plural(d.supplier_count, 'leverancier', 'leveranciers') }),
    el('td', {}, [voortgang(d)]),
    el('td', {}, [el('div', { class: 'row' }, [
      el('a', {
        class: 'btn btn--sm',
        href: `/ontvangst?id=${d.id}`,
        text: d.checked_lines ? 'Verder inboeken' : 'Levering inboeken',
      }),
      el('a', { class: 'btn btn--sm btn--ghost', href: `/bestelling?id=${d.id}`, text: 'Bestelling' }),
    ])]),
  ]);
}

function doneRow(d) {
  return el('tr', {}, [
    el('td', {}, [
      el('a', { href: `/bestelling?id=${d.id}`, text: d.location_name }),
      el('div', { class: 'muted small', text: `telling ${d.id} · ${dateNl(d.counted_on)}` }),
    ]),
    el('td', { text: d.received_at ? dateNl(d.received_at.slice(0, 10)) : '—' }),
    el('td', { class: 'small', text: d.received_by || '—' }),
    el('td', { class: 'num', text: `${d.checked_lines} / ${d.order_lines}` }),
    el('td', {}, [afwijking(d)]),
    el('td', {}, [el('a', { class: 'btn btn--sm btn--ghost', href: `/ontvangst?id=${d.id}`, text: 'Nakijken' })]),
  ]);
}

const tabel = (koppen, rijen) => el('div', { class: 'table-wrap' }, [el('table', {}, [
  el('thead', {}, [el('tr', {}, koppen.map((k) => el('th', { class: k.num ? 'num' : '', text: k.text })))]),
  el('tbody', {}, rijen),
])]);

function openCard(data) {
  if (!data.open.length) {
    return card('Nog na te kijken', el('p', { class: 'muted', text: 'Alles is nagekeken. Zodra er uit een telling een bestelling volgt, verschijnt ze hier.' }));
  }
  return card('Nog na te kijken',
    el('p', { class: 'small muted', text: 'Vul in wat de leverancier effectief gebracht heeft. Wat je leeg laat, blijft "nog niet nagekeken".' }),
    tabel([
      { text: 'Locatie' }, { text: 'Bestelregels', num: true }, { text: 'Leveranciers', num: true },
      { text: 'Voortgang' }, { text: '' },
    ], data.open.map(openRow)));
}

function doneCard(data) {
  if (!data.done.length) return null;
  return card('Afgesloten leveringen', tabel([
    { text: 'Locatie' }, { text: 'Nagekeken op' }, { text: 'Door' },
    { text: 'Regels', num: true }, { text: 'Resultaat' }, { text: '' },
  ], data.done.map(doneRow)));
}

async function load() {
  const data = await api(`/api/deliveries${companyId ? `?company_id=${companyId}` : ''}`);
  const content = clear(qs('#content'));
  content.append(openCard(data));
  const gedaan = doneCard(data);
  if (gedaan) content.append(gedaan);
}

async function init() {
  const header = await mountHeader('leveringen');
  companyId = header.companyId;
  if (!companyId) {
    qs('#messages').replaceChildren(el('div', { class: 'notice' }, [
      'Er is nog geen bedrijf ingesteld. ', el('a', { href: '/beheer', text: 'Maak er eerst één aan bij Beheer' }), '.',
    ]));
    clear(qs('#content'));
    return;
  }
  await load();
}

init().catch((err) => {
  clear(qs('#content'));
  qs('#messages').replaceChildren(el('div', { class: 'notice notice--error', text: err.message }));
});
