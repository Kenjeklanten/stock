import { api, toast, el, clear, qs, mountHeader, dateNl } from './app.js';

let isAdmin = true;
let companyId = null;

async function remove(count) {
  if (!confirm(`Telling ${count.id} van ${dateNl(count.counted_on)} (${count.location_name}) verwijderen?`)) return;
  try {
    await api(`/api/counts/${count.id}`, { method: 'DELETE' });
    toast('Telling verwijderd.');
    await load();
  } catch (err) { toast(err.message, true); }
}

function row(c) {
  return el('tr', {}, [
    el('td', {}, [el('a', { href: `/bestelling?id=${c.id}`, text: dateNl(c.counted_on) }), el('div', { class: 'muted small', text: `nr. ${c.id}` })]),
    el('td', { text: c.location_name }),
    el('td', { class: 'small', text: c.created_by || '—' }),
    el('td', { class: 'num', text: String(c.counted_lines) }),
    el('td', { class: 'num' }, [c.order_lines > 0 ? el('b', { text: String(c.order_lines) }) : el('span', { class: 'muted', text: '0' })]),
    el('td', {}, [el('span', { class: c.status === 'besteld' ? 'tag tag--mint' : 'tag tag--sun', text: c.status })]),
    el('td', {}, [
      el('div', { class: 'row' }, [
        el('a', { class: 'btn btn--sm btn--ghost', href: `/bestelling?id=${c.id}`, text: 'Bekijk' }),
        el('a', { class: 'btn btn--sm btn--ghost', href: `/api/counts/${c.id}/pdf`, target: '_blank', rel: 'noopener', text: 'PDF' }),
        el('a', { class: 'btn btn--sm btn--ghost', href: `/api/export/xlsx?count_id=${c.id}`, text: 'Excel' }),
        el('a', { class: 'btn btn--sm btn--ghost', href: `/api/counts/${c.id}/csv`, text: 'CSV' }),
        isAdmin ? el('button', { class: 'btn btn--sm btn--danger', onclick: () => remove(c), text: 'Verwijder' }) : null,
      ]),
    ]),
  ]);
}

async function load() {
  const locationId = qs('#location').value;
  const { counts } = await api(`/api/counts?limit=100${companyId ? `&company_id=${companyId}` : ''}` +
    (locationId ? `&location_id=${encodeURIComponent(locationId)}` : ''));
  const box = clear(qs('#list'));
  if (!counts.length) {
    box.append(el('p', { class: 'skeleton', text: 'Nog geen tellingen bewaard.' }));
    return;
  }
  box.append(el('table', {}, [
    el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Datum' }), el('th', { text: 'Locatie' }), el('th', { text: 'Geteld door' }),
      el('th', { class: 'num', text: 'Geteld' }), el('th', { class: 'num', text: 'Besteld' }),
      el('th', { text: 'Status' }), el('th', { text: '' }),
    ])]),
    el('tbody', {}, counts.map(row)),
  ]));
}

async function init() {
  const header = await mountHeader('historiek');
  isAdmin = !header.user || header.user.admin !== false;
  companyId = header.companyId;
  if (!companyId) {
    qs('#messages').replaceChildren(el('div', { class: 'notice' }, [
      'Er is nog geen bedrijf ingesteld. ', el('a', { href: '/beheer', text: 'Maak er eerst één aan bij Beheer' }), '.',
    ]));
    qs('#list').replaceChildren();
    return;
  }
  const { locations } = await api(`/api/catalog?company_id=${companyId}`);
  const select = qs('#location');
  for (const l of locations) select.append(el('option', { value: String(l.id), text: l.name + (l.active ? '' : ' (non-actief)') }));
  select.addEventListener('change', () => load().catch((e) => toast(e.message, true)));
  await load();
}

init().catch((err) => qs('#messages').replaceChildren(el('div', { class: 'notice notice--error', text: err.message })));
